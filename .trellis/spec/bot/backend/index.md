# @repo-gossip/bot — Backend Guidelines

Long-running chat bots (Discord / Telegram) and shared Feishu handlers. Vercel webhook adapters live in root `api/` and reuse these modules.

**Package path**: `apps/bot`  
**Depends on**: `@repo-gossip/core` only for gossip logic

---

## Pre-Development Checklist

- [ ] Platform file only parses chat input and replies — call `runGossip` / format helpers from core
- [ ] Production webhooks require secrets (`WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `FEISHU_VERIFICATION_TOKEN`)
- [ ] Prefer `npm run bot` for Discord until Interactions signature verify exists
- [ ] Load env from **repo root** `.env`

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | bot + api layout |
| [Platform Adapters](./platforms.md) | Discord / Telegram / Feishu patterns |
| [Error Handling](./error-handling.md) | User-visible failures + HTTP codes |
| [Logging](./logging-guidelines.md) | Startup and request logs |
| [Quality](./quality-guidelines.md) | Thin adapters, secrets |

## Quality Check

- [ ] No duplicate analyzer/LLM logic in bot or api
- [ ] Prod secret gates still fail closed
- [ ] `npm run typecheck -w @repo-gossip/bot`
