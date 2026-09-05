# Logging — bot / api

- Startup: Chinese status lines (`Discord 已上线`, `Telegram Bot 开始轮询…`).
- Serverless: `console.error(err)` in telegram webhook catch; gossip returns JSON errors to client.
- Prefer user-facing replies over verbose platform logs for expected failures (bad repo, gossip error).

Do not log bot tokens, webhook secrets, or Feishu app secrets.
