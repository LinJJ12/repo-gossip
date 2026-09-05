# Error Handling — bot / api

## Chat bots

- Catch around `runGossip` and send a short failure message to the user.
- Invalid repo input: ask for correct format (Telegram/Feishu) before calling core.
- Feishu: return `{ ok: false, error }` when target ids missing; still prefer sending user text when possible.

## HTTP (api/)

| Condition | Status |
|-----------|--------|
| Wrong method | 405 |
| Bad JSON / missing repo | 400 |
| Auth failure | 401 |
| Missing required prod secrets | 500 with explicit error string |
| Gossip failure | 500 `{ error }` |
| Discord interactions stub | 501 |

## Auth rules (current code)

- `/api/gossip`: `WEBHOOK_SECRET` via `Authorization: Bearer` or `x-webhook-secret`. In production (`VERCEL` / `NODE_ENV=production`), missing secret → 500 (fail closed). Health GET without `?repo=` stays open.
- `/api/telegram`: `TELEGRAM_WEBHOOK_SECRET` vs `x-telegram-bot-api-secret-token`.
- `/api/feishu`: `FEISHU_VERIFICATION_TOKEN` on challenge and events.

## Anti-patterns

- ACKing Discord PING without Ed25519 verify
- Allowing unauthenticated gossip in production by omitting `WEBHOOK_SECRET`
- Leaking stack traces to chat clients (message only)
