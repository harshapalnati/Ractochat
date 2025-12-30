# Anthropic-Focused Rust MVP (SQLite)

Purpose: multi-tenant chat with org isolation, role-based model access, PII redaction, audit logging, and streaming responses using Anthropic models (Opus 4.5 / Sonnet 4.5 / Haiku 4.5). Targets SQLite for speed; keep SQL portable to upgrade to Postgres later.

## Stack
- HTTP: Axum + Tower; body with `serde_json`.
- DB: SQLx (`sqlite` feature); WAL mode + `PRAGMA foreign_keys=ON`.
- Auth: `jsonwebtoken` (HS256), password hashing with `argon2`, cookies via `axum-extra` (HttpOnly, Secure, SameSite=Lax/Strict).
- PII: Presidio sidecar over HTTP (fast path), regex fallback for dev/offline.
- LLM: Trait-based drivers with an Anthropic client using `reqwest`.
- Observability: `tracing`, `tracing-subscriber`, `tracing-appender`, `sentry` crate.
- Validation: `validator` crate; config via `config` crate + env overrides.

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

SQLite notes: enable WAL; keep SQL portable (no vendor-specific functions). When migrating to Postgres, swap REAL→NUMERIC, TEXT UUID→uuid type, timestamps→timestamptz.

## API Surface (/api/v1)
- POST /auth/login → set JWT cookie; body {email,password}
- POST /auth/logout → clear cookie
- GET /models → allowed models for user/org
- GET /conversations, POST /conversations
- GET /conversations/:id/messages
- POST /chat → non-stream response
- GET /chat/stream → SSE streaming response
- GET/POST /admin/policies → admin only
- GET /admin/audit → admin only, paginated

## Middleware / Guards
- Auth extractor: read cookie, validate JWT, attach UserCtx {user_id, org_id, role}.
- Org/RBAC: enforce org ownership on conversations/messages; enforce model policy per request.
- Rate limit: simple in-memory token bucket (per user/org) or Redis-backed if enabled.
- Tracing: inject request_id, org_id, user_id into spans for audit correlation.

## Chat Flow
1) AuthN/Z: validate JWT; check conversation belongs to org; check role access to model.
2) PII: send message to Presidio sidecar `/pii/analyze`; receive redacted text + findings. If sidecar down, run regex fallback. Mark pii_redacted flag and store detections.
3) Persist user message (store redacted; store original only if encrypted with a local key).
4) Fetch recent history (last N turns) for context.
5) Call Anthropic client with redacted history.
6) Token/cost: compute from pricing table (input_cost/output_cost).
7) Persist assistant message with tokens/cost/latency; insert pii_detections rows.
8) Append audit log row (action=chat.send) with metrics.
9) Stream back via SSE (heartbeat every ~20s) or return full JSON.

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
Retry/backoff on 429/5xx with jitter; map Anthropic errors to LlmError.

Anthropic specifics:
- Endpoint: POST https://api.anthropic.com/v1/messages
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`
- Payload: model, messages[{role, content}], max_tokens, temperature, stream? (bool)
- Streaming: SSE-style chunks; parse `delta` content, yield text increments.
- Models: opus-4-5, sonnet-4-5, haiku-4-5 (or latest SKU names). Store pricing in models table.

## PII Service
- Sidecar contract: POST /pii/analyze {text} -> {redacted_text, findings:[{type,start,end,text,confidence}]}
- Fallback regex: emails, phones, credit cards, SSNs, names (coarse), locations (coarse).
- Store detections in pii_detections; set pii_redacted on messages.
- Do not send original text to Anthropic.

## Auth / JWT
- Claims: sub (user_id), org, role, exp. HS256 signed with JWT_SECRET.
- Cookie: HttpOnly, Secure, SameSite=Lax/Strict, Path=/.
- Expiry: 24h; refresh flow optional for MVP.
- Passwords: argon2id with salt; verify on login.

## Validation
- Use `validator` on DTOs; max message length (~8000 chars); require model_id present; ensure conversation_id belongs to org.

## Cost Calculation
- cost = tokens_in * input_cost + tokens_out * output_cost (from models table). Store on messages and in audit details.

## Audit Logging
- Structured JSON via tracing layer; write to audit_logs table + append-only file. Fields: timestamp, request_id, org_id, user_id, action, model_id, tokens_in/out, cost, latency_ms. Forward 5xx to Sentry.

## Config
- Fields: address, database_url (sqlite path), redis_url (optional), jwt_secret, sentry_dsn, pii_sidecar_url, rate_limit.
- Load via `config` crate; override with env vars. Set PRAGMAs on pool init: WAL, foreign_keys=ON.

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
- Auth: invalid/expired JWT rejected; cookie required; wrong org access denied.
- RBAC: model access policy enforced; users cannot read other org conversations.
- PII: redaction of email/phone/cc/ssn; outbound payload never contains original PII.
- Cost: pricing table applied correctly to tokens in/out.
- Streaming: SSE yields increments and ends cleanly; heartbeat works.

## Operational Notes
- Start with SQLite + WAL; keep migrations portable for Postgres later.
- Optional Redis: use feature flag to enable cache/rate limit.
- CORS: allow frontend origin only; disable in dev as needed.
- Secrets via env vars; no secrets in repo.

## Ready-To-Implement Next Steps
- Scaffold Axum app with middleware (auth extractor, org guard, rate limit).
- Implement SQLx repositories for users/models/policies/conversations/messages/audit.
- Build PII client (sidecar + regex fallback).
- Build Anthropic client (chat + streaming) implementing LlmClient.
- Wire /chat and /chat/stream handlers with the flow above.
- Add migrations and a seed script for: default org, admin user, models, policies.
