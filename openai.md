# OpenAI-Focused Rust MVP (SQLite)

Purpose: multi-tenant chat with org isolation, role-based model access, PII redaction, audit logging, and streaming responses using OpenAI models (GPT-5.2 Instant/Thinking/Pro, GPT-5.2-Codex). Uses SQLite for speed; SQL kept portable for a later Postgres swap.

## Stack
- HTTP: Axum + Tower; JSON with `serde_json`.
- DB: SQLx (`sqlite` feature); WAL + `PRAGMA foreign_keys=ON`.
- Auth: `jsonwebtoken` (HS256), `argon2` for password hashing, cookies via `axum-extra` (HttpOnly, Secure).
- PII: Presidio sidecar over HTTP; regex fallback for dev/offline.
- LLM: Trait-based drivers with an OpenAI client using `reqwest`.
- Observability: `tracing`, `tracing-subscriber`, `tracing-appender`, `sentry` crate.
- Validation: `validator` crate; config via `config` + env overrides.

## Data Model (SQLite)
Tables (TEXT UUIDs, timestamps as RFC3339 TEXT):
- organizations: id, name, created_at
- users: id, org_id, email (unique per org), name, role (admin|user|legal), password_hash, created_at
- models: id, provider, model_name, display_name, input_cost, output_cost, capabilities (JSON TEXT), created_at
- model_access_policies: id, org_id, role, model_id
- conversations: id, org_id, user_id, title, created_at
- messages: id, conv_id, org_id, user_id, role (user|assistant), content, model_id, tokens_input, tokens_output, cost, latency_ms, pii_redacted (BOOL), created_at
- audit_logs: id, org_id, user_id, action, details (JSON TEXT), created_at
- pii_detections: id, message_id, org_id, pii_type, redacted (BOOL), confidence, created_at

SQLite notes: enable WAL; keep SQL portable. Postgres migration: REAL→NUMERIC, TEXT UUID→uuid, timestamps→timestamptz.

## API Surface (/api/v1)
- POST /auth/login → set JWT cookie
- POST /auth/logout
- GET /models
- GET /conversations; POST /conversations
- GET /conversations/:id/messages
- POST /chat → non-stream
- GET /chat/stream → SSE stream
- GET/POST /admin/policies → admin only
- GET /admin/audit → admin only, paginated

## Middleware / Guards
- Auth extractor: reads HttpOnly cookie, validates JWT, attaches UserCtx {user_id, org_id, role}.
- Org/RBAC: enforce org ownership on conversations/messages; enforce model access policy.
- Rate limit: in-memory token bucket (per user/org) or Redis-backed if enabled.
- Tracing: span fields request_id/org_id/user_id for audit correlation.

## Chat Flow
1) AuthN/Z: validate JWT; verify conversation belongs to org; check role permits model.
2) PII: Presidio sidecar `/pii/analyze`; fallback regex if sidecar unavailable. Mark pii_redacted and store detections.
3) Persist user message (store redacted; store original only if encrypted).
4) Fetch recent history (limit last N turns).
5) Call OpenAI client with redacted history.
6) Compute tokens/cost using models table pricing.
7) Persist assistant message with tokens/cost/latency; insert pii_detections.
8) Append audit log (action=chat.send) with metrics.
9) Stream back via SSE with heartbeat or return JSON.

## LLM Abstraction
Trait:
```rust
#[async_trait]
pub trait LlmClient {
    async fn chat(&self, req: ChatRequest) -> Result<ChatResponse, LlmError>;
    async fn stream_chat(&self, req: ChatRequest) -> Result<ChatStream, LlmError>;
}
```
ChatRequest: model_id, messages, temperature, max_tokens, metadata (org/user).  
ChatResponse: content, tokens_in, tokens_out, latency_ms.  
Retry/backoff on 429/5xx with jitter; map OpenAI errors to LlmError.

OpenAI specifics:
- Endpoint: POST https://api.openai.com/v1/chat/completions
- Headers: `Authorization: Bearer $OPENAI_API_KEY`
- Payload: model, messages[{role, content}], temperature, max_tokens, stream? (bool), response_format?, tools? (extend later)
- Streaming: SSE-style chunks; parse `choices[0].delta.content` to yield text increments.
- Models: gpt-5.2-instant, gpt-5.2-thinking, gpt-5.2-pro, gpt-5.2-codex. Store pricing in models table.

## PII Service
- Sidecar contract: POST /pii/analyze {text} -> {redacted_text, findings:[{type,start,end,text,confidence}]}
- Regex fallback: emails, phones, credit cards, SSNs, names/locations (coarse).
- Store detections in pii_detections; set pii_redacted on messages.
- Only redacted text goes to OpenAI.

## Auth / JWT
- Claims: sub (user_id), org, role, exp. HS256 with JWT_SECRET.
- Cookie: HttpOnly, Secure, SameSite=Lax/Strict.
- Expiry: 24h; refresh optional for MVP.
- Passwords: argon2id.

## Validation
- `validator` on DTOs; max message length (~8000 chars); require model_id; conversation_id must belong to org.

## Cost Calculation
- cost = tokens_in * input_cost + tokens_out * output_cost (from models table). Store on messages and in audit details.

## Audit Logging
- Structured JSON via tracing layer; write to audit_logs table + append-only file. Fields: timestamp, request_id, org_id, user_id, action, model_id, tokens_in/out, cost, latency_ms. Capture 5xx in Sentry.

## Config
- Fields: address, database_url (sqlite path), redis_url (optional), jwt_secret, sentry_dsn, pii_sidecar_url, rate_limit.
- Load via `config` crate; env overrides. On pool init: set WAL, foreign_keys=ON.

## Migrations (SQLite skeleton)
Use SQLx migrations. Example 001_init.sql:
```sql
PRAGMA foreign_keys = ON;
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, email)
);
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  input_cost REAL NOT NULL,
  output_cost REAL NOT NULL,
  capabilities TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE model_access_policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES models(id)
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL REFERENCES conversations(id),
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_id TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost REAL,
  latency_ms INTEGER,
  pii_redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE pii_detections (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  org_id TEXT NOT NULL,
  pii_type TEXT NOT NULL,
  redacted INTEGER NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL
);
```

## Testing Priorities (MVP)
- Auth: invalid/expired JWT rejected; cookie required; cross-org access denied.
- RBAC: model access policy enforced; users cannot read other org conversations.
- PII: redact email/phone/cc/ssn; outbound payloads are redacted.
- Cost: pricing table applied correctly to tokens in/out.
- Streaming: SSE yields deltas and closes cleanly; heartbeat present.

## Operational Notes
- SQLite + WAL for dev; keep migrations vendor-neutral to swap to Postgres.
- Optional Redis for rate limit/cache; hide behind a feature flag.
- CORS: allow frontend origin; lock down in production.
- Secrets from env vars only.

## Ready-To-Implement Next Steps
- Scaffold Axum app with middleware (auth extractor, org guard, rate limiter).
- Implement SQLx repos for users/models/policies/conversations/messages/audit.
- Build PII client (sidecar + regex fallback).
- Build OpenAI client (chat + streaming) implementing LlmClient.
- Wire /chat and /chat/stream handlers to the flow above.
- Add migrations and a seed script for default org, admin user, models, policies.
