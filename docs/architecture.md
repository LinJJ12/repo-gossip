# Architecture

Monorepo layout inspired by common GitHub bot + web projects
([OctoBot](https://github.com/gabrielccarvalho/octobot)-style `apps/` + `packages/`,
with Vercel `api/` kept at the repo root like Probot apps).

```
repo-gossip/
├── packages/core/     # Gossip engine: GitHub · analyzer · LLM · format · CLI
├── apps/
│   ├── web/           # Vite React preview
│   ├── bot/           # Discord / Telegram / Feishu long-running process
│   └── extension/     # Chrome MV3 sideload extension
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
  → apps/web | apps/bot | api/* | apps/extension
```

### Client-side history（不经服务端）

| Surface | Store | Notes |
|---------|--------|--------|
| Web「最近」 | `localStorage` · `repoGossipHistory` | 最多 20；与扩展不同步 |
| Extension「最近」 | `chrome.storage.local` · `repoGossipHistory` | 侧边栏 / 弹层 / 完整页共用；写入经 background `HISTORY_UPSERT` |

Secrets (`GITHUB_TOKEN`, `LLM_API_KEY`, bot tokens, optional `WEBHOOK_SECRET`) live only in root
`.env` or host env vars — never in the frontend bundle. Per-request BYOK headers
(`x-github-token`, `x-llm-api-key`, `x-llm-base-url`, `x-llm-model`) override server env for that
call only and must never be logged or echoed.

### `/api/gossip` auth (public by default)

- Browser / extension callers do **not** need `WEBHOOK_SECRET`.
- If `WEBHOOK_SECRET` is set and the request sends a non-matching `Authorization: Bearer` or
  `x-webhook-secret`, respond `401`.
- Optional internal callers may send a matching secret.
- Kill-switch: `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` restores the old “require secret in production”
  behavior.
- CORS: `OPTIONS` + `GOSSIP_CORS_ORIGINS` (comma-separated) or `*` for `Access-Control-Allow-Origin`.
- In-process rate limits (`GOSSIP_RATE_LIMIT_*_PER_HOUR`) and TTL cache (`GOSSIP_CACHE_TTL_SEC`);
  multi-instance deployments do not share this state. Internal Bearer calls skip the IP bucket.
  Cache is checked **before** rate-limit consume; keys include `format`. Responses may include
  `X-Cache: HIT|MISS` and `429` + `Retry-After` when limited. `days` is clamped to 1–90.
- BYOK `x-llm-base-url` must pass `isAllowedLlmBaseUrl` (blocks cloud metadata / non-http(s)).

Production checklist:

- Optional: `WEBHOOK_SECRET` for internal callers; `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` only if you
  want to force auth again
- Optional: `GOSSIP_CORS_ORIGINS` for browser origins
- Optional: rate-limit / cache env vars (see `.env.example`)
- Set `TELEGRAM_WEBHOOK_SECRET` if using `/api/telegram`
- Set `FEISHU_VERIFICATION_TOKEN` if using `/api/feishu`
- Prefer `npm run bot` for Discord — `/api/discord` returns **501** until Ed25519
Interactions verification lands; do not point Discord’s Interactions Endpoint at it.
