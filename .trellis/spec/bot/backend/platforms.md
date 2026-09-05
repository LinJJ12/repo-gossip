# Platform Adapters — bot

## Shared patterns

1. Extract `owner/repo` (or GitHub URL) with a small regex / slash option.
2. Optionally notify user that work started (`deferReply`, “正在偷看…”, Feishu text).
3. `await runGossip({ repo, offline })`.
4. Format with core helpers (`toDiscordEmbed`, `message.plain`, `toFeishuCard`).
5. Catch errors → reply with `八卦失败：…` / `Gossip failed: …` — do not crash the process.

## Discord (`platforms/discord.ts`)

- Intents: `Guilds` only; slash command `gossip` with required `repo` string.
- Register commands on `ClientReady` via REST `applicationCommands`.
- Always `deferReply` before `runGossip` (LLM latency).
- Map `toDiscordEmbed` fields onto `EmbedBuilder`.

## Telegram (`platforms/telegram.ts`)

- `/start` help, `/gossip <repo>`, and bare message text matching `REPO_RE`.
- Reply with `message.plain.slice(0, 4000)` + inline “打开仓库” URL button.
- Long-running: `bot.start()` polling from `apps/bot/src/index.ts`.
- Serverless: `api/telegram.ts` wraps same bot with `webhookCallback` + `TELEGRAM_WEBHOOK_SECRET`.

## Feishu (`platforms/feishu.ts`)

- `handleFeishuChallenge` for URL verification (token check when configured).
- `handleFeishuMessage` parses message JSON `content.text`, resolves `chat_id` or `open_id`.
- Sends progress text, optional mode warning, then interactive card from `toFeishuCard`.
- Tenant token via Feishu open API; errors throw with truncated body snippets.

## Anti-patterns

- Implementing Discord Interactions ACK in `api/discord.ts` without signature verification (currently correctly returns 501)
- Embedding gossip prompts or analyzer rules inside platform files
- Ignoring production secret requirements documented in `docs/architecture.md`
