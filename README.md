# Ractochat

Multi-model chat lab with a Rust (Axum) backend and a Next.js App Router frontend. The backend enforces basic guardrails, streaming, policy checks, and simple account limits; the frontend provides a chat UI and an admin dashboard.

## What’s inside
- `backend/` – Axum + SQLx API (SQLite), model router, policy/guardrail handling.
- `frontend/` – Next.js 16 + React 19 chat UI with SSE streaming and an admin panel.
- `data/` – Local SQLite data directory (DB files ignored; `.gitkeep` placeholder).
- `claude.md`, `openai.md` – Design notes for Anthropic and OpenAI-focused MVPs.

## Prereqs
- Rust toolchain (stable) + SQLite headers
- Node.js 20+ and npm

## Backend (Axum)
1) `cp .env.example .env` and update secrets:
   - `DATABASE_URL=sqlite://./data/app.db` (created automatically, migrations run on boot)
   - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` if you want live LLM calls
   - `ALLOWED_ORIGINS` for CORS (e.g., `http://localhost:3000`)
   - `JWT_SECRET` for auth cookies
2) Run from repo root:  
   `cargo run -p backend`
3) API listens on `HOST:PORT` (defaults `0.0.0.0:8000`). Health: `GET /health`.
4) Stub login: `POST /api/v1/auth/login` accepts `demo@local / demo123` and issues an auth cookie for user `demo-user`.

Key endpoints:
- Chat: `POST /api/v1/chat` (JSON) and `POST /api/v1/chat/stream` (SSE)
- Admin: `/api/v1/admin/*` for policies, models, aliases, fallbacks, and account limits

## Frontend (Next.js)
1) `cd frontend`
2) `cp .env.example .env.local` and set `NEXT_PUBLIC_API_URL` (e.g., `http://localhost:8000`)
3) Install deps: `npm install`
4) Start dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`
5) Open http://localhost:3000/chat and log in with `demo@local / demo123` (button in the sidebar).

## Default routing/account seed
- Accounts live in-memory (see `backend/src/model_router/accounts.rs`); demo user `demo-user` is active with guardrails, per-day limits, and cost caps.
- Model aliases/fallbacks live in `backend/src/model_router/catalog.rs`.

## Notes
- SQLite files under `data/` are ignored by git; migrations are in `backend/migrations/`.
- The frontend stores conversations locally in `localStorage`.
- CORS is mirrored by default; set `ALLOWED_ORIGINS` in prod.
