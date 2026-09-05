# Architecture

Monorepo layout inspired by common GitHub bot + web projects
([OctoBot](https://github.com/gabrielccarvalho/octobot)-style `apps/` + `packages/`,
with Vercel `api/` kept at the repo root like Probot apps).

```
repo-gossip/
├── packages/core/     # Gossip engine: GitHub · analyzer · LLM · format · CLI
├── apps/
│   ├── web/           # Vite React preview
│   └── bot/           # Discord / Telegram / Feishu long-running process
├── api/               # Vercel Serverless entrypoints (thin adapters)
├── test/              # Unit tests for core
├── docs/              # Design notes
├── package.json       # npm workspaces root
└── .env.example
```

## Data flow

```
repo URL
  → packages/core (fetch → analyze → LLM/offline → tabloid)
  → apps/web | apps/bot | api/*
```

Secrets (`GITHUB_TOKEN`, `LLM_API_KEY`, bot tokens, `WEBHOOK_SECRET`) live only in root `.env`
or host env vars — never in the frontend bundle.

Production checklist:

- Set `WEBHOOK_SECRET` (required on Vercel for `/api/gossip`)
- Set `TELEGRAM_WEBHOOK_SECRET` if using `/api/telegram`
- Set `FEISHU_VERIFICATION_TOKEN` if using `/api/feishu`
- Prefer `npm run bot` for Discord (Interactions webhook returns 501 until signature verify lands)
