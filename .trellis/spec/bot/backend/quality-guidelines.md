# Quality Guidelines — bot / api

## Principles

- **Thin adapters**: platform code = parse → `runGossip` → format → reply.
- **Reuse**: `api/telegram.ts` and `api/feishu.ts` import from `apps/bot/src/platforms/*`; do not fork handlers.
- **Offline flag**: CLI argv `--offline` or `GOSSIP_OFFLINE=1`.
- At least one of `DISCORD_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN` required for `npm run bot`.

## TypeScript

- ESM + `.js` import suffixes in relative paths.
- Typecheck workspace: `npm run typecheck -w @repo-gossip/bot`.
- No dedicated bot unit tests yet; core tests cover gossip. When adding bot tests, prefer pure helpers (regex, challenge) over live network.

## No database

Bots are stateless per request aside from in-memory Telegram bot singleton on Vercel warm instances.

## Anti-patterns

- Copy-pasting `authorize` logic inconsistently — prefer `api/_auth.ts` when touching gossip auth
- Adding frontend/React under `apps/bot` (UI lives in `apps/web`)
- Shipping Discord webhook that accepts unsigned bodies
