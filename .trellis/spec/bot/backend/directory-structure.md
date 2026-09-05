# Directory Structure — bot (+ api)

## apps/bot

```
apps/bot/src/
├── index.ts                 # Long-running process: Discord and/or Telegram polling
└── platforms/
    ├── discord.ts           # discord.js slash /gossip + EmbedBuilder
    ├── telegram.ts          # grammy Bot; commands + plain-text repo links
    └── feishu.ts            # Challenge + message handlers (no long-poll entry yet)
```

`index.ts` notes: Feishu is **webhook-oriented** (used from `api/feishu.ts`). Discord Interactions on Vercel are **not ready** — stub returns 501.

## Root api/ (Vercel thin adapters)

```
api/
├── _auth.ts      # Shared WEBHOOK_SECRET helper (partially duplicated in gossip.ts)
├── gossip.ts     # POST/GET gossip API; format=web|json|markdown|discord|feishu
├── telegram.ts   # webhookCallback(createTelegramBot(...))
├── feishu.ts     # challenge + handleFeishuMessage
└── discord.ts    # Stub 501 until Ed25519 verify
```

## Boundary rules

| Layer | Responsibility |
|-------|----------------|
| `apps/bot/src/platforms/*` | Platform SDK, parse repo from message, reply UX |
| `api/*` | HTTP method/auth/env wiring only |
| `@repo-gossip/core` | All gossip computation and payload builders |

## Imports

- Bot package: `import { runGossip, toDiscordEmbed } from "@repo-gossip/core"`
- Vercel api currently imports relative TS paths (`../packages/core/src/index.js`, `../apps/bot/src/platforms/...`) for bundling — keep adapters thin when touching these files.

## Env

Single root `.env` (see `.env.example`). `GOSSIP_OFFLINE=1` forces offline mode in bot/webhooks.
