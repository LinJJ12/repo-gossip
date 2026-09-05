# 📰 repo-gossip

> 把仓库链接丢给 Bot，它不给你看枯燥的提交列表，而是给你整一份 **「项目八卦小报」**。

零依赖音视频、只需 **GitHub API + LLM**；可跑 CLI，也可挂到 **Discord / Telegram / 飞书**，部署在 Vercel / Railway。

发到技术群里，所有人都会去试自己的仓库——「看看我的项目被 Bot 怎么吐槽」。

---

## 小报长什么样

| 板块 | 内容示例 | 情绪价值 |
|------|----------|----------|
| 🎬 本周大片 | 《深夜重构：十万行 Legacy Code 的救赎》 | 仓库瞬间有史诗感 |
| 🏆 颁奖典礼 | 「最佳卷王奖」——周六凌晨 3 点提交的那位 | Review 气氛组 |
| 📊 项目体温 | 🔥 热得发烫 / 🥶 已凉 | 一眼看活性 |
| 💬 提交信翻译 | `fix: 修改 bug` → 高烧救人文学 | 废话文学拉满 |
| 🕵️ 彩蛋侦探 | 提交里出现 `console.log('test')` →「有内鬼，终止交易！」 | Review 预警 |

---

## 目录结构

npm workspaces monorepo（参考 OctoBot 等 `apps/` + `packages/`，`api/` 留在根目录以适配 Vercel）：

```
repo-gossip/
├── packages/core/     # 八卦引擎：GitHub · 分析 · LLM · 排版 · CLI
├── apps/
│   ├── web/           # Vite React 预览站
│   └── bot/           # Discord / Telegram / 飞书常驻进程
├── api/               # Vercel Serverless 入口
├── test/              # 核心单测
├── docs/              # 架构说明
└── package.json       # workspaces 根
```

详见 [docs/architecture.md](docs/architecture.md)。

---

## 60 秒体验（无需 LLM）

```bash
npm install
npm run web
# 浏览器打开 http://localhost:5173 ，输入仓库即可预览小报
```

或用 CLI：

```bash
npm run gossip -- https://github.com/vercel/next.js --offline
```

有 LLM Key 时去掉 `--offline`，翻译会从「土味模板」升级成完整八卦笔力。

```env
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
GITHUB_TOKEN=ghp_...   # 可选；提高限额或读私有仓
```

---

## 架构数据流

```
仓库链接
   │
   ▼
packages/core ──► GitHub 拉取 → 分析 → LLM/离线 → 小报
   │
   ├── apps/web      预览站
   ├── apps/bot      即时通讯 Bot
   └── api/*         Serverless Webhook
```

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run gossip -- owner/repo` | CLI 出报 |
| `npm run web` | 启动预览站 |
| `npm run bot` | 启动 Discord/Telegram 长连接 |
| `npm test` | 跑核心单测 |
| `npm run typecheck` | 全仓库类型检查 |

---

## Bot 接入

### Telegram

1. [@BotFather](https://t.me/BotFather) 创建 Bot，拿到 `TELEGRAM_BOT_TOKEN`
2. 本地轮询：`TELEGRAM_BOT_TOKEN=xxx npm run bot`
3. 或 Vercel Webhook：`https://<域名>/api/telegram`（建议配置 `TELEGRAM_WEBHOOK_SECRET`）

### Discord

常驻：`DISCORD_BOT_TOKEN=xxx npm run bot`，使用 `/gossip repo:owner/repo`

### 飞书

事件订阅：`https://<域名>/api/feishu`，配置 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_VERIFICATION_TOKEN`

### HTTP API

```bash
curl -X POST https://<domain>/api/gossip \
  -H "content-type: application/json" \
  -d '{"repo":"vercel/next.js","format":"web","offline":true}'
```

`format`：`web`（默认，含 tabloid）| `markdown` | `json` | `discord` | `feishu`

---

## 部署

### Vercel

根目录直接 `npx vercel`（`api/` 在仓库根）。Dashboard **务必**填入：

- `WEBHOOK_SECRET`（生产必填，保护 `/api/gossip`）
- `GITHUB_TOKEN` / `LLM_API_KEY`（按需）
- Bot 相关：`TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`，或飞书三件套

调用受保护接口时：

```bash
curl -X POST https://<domain>/api/gossip \
  -H "authorization: Bearer $WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"repo":"vercel/next.js","format":"web","offline":true}'
```

无 LLM 演示可设 `GOSSIP_OFFLINE=1`。

### Railway / 常驻 Bot

```bash
npm install
DISCORD_BOT_TOKEN=xxx TELEGRAM_BOT_TOKEN=xxx npm run bot
```

---

## 开发

```bash
cp .env.example .env
npm install
npm run gossip -- owner/repo --offline
npm test
npm run typecheck
```

## License

MIT
