# ractochat frontend

Next.js 14 App Router UI for the multi-model chat lab. It talks to the Rust/Axum backend at `NEXT_PUBLIC_API_URL`.

## Run locally
```bash
cp .env.example .env.local   # or set NEXT_PUBLIC_API_URL
npm install
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Open http://localhost:3000/chat and select a model (OpenAI or Anthropic). The API URL should point at the backend (default in `.env.example` is `http://165.227.73.249:8000`).

## Deploy to Vercel
- Import this repo.
- Set `NEXT_PUBLIC_API_URL` in Vercel Project Settings → Environment Variables.
- Build command: `npm run build` (defaults are fine).
- Output: `.next` (Vercel default).
