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
│   ├── bot/           # Discord / Telegram / 飞书常驻进程
│   └── extension/     # Chrome MV3 开源扩展（sideload）
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

CI：push / PR 会跑 `npm test` 与 `npm run typecheck`（见 `.github/workflows/ci.yml`）。

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

公开路径（默认无需 `WEBHOOK_SECRET`）：

```bash
curl -X POST https://<domain>/api/gossip \
  -H "content-type: application/json" \
  -d '{"repo":"vercel/next.js","format":"web","offline":true}'
```

`format`：`web`（默认，含 tabloid）| `markdown` | `json` | `discord` | `feishu`

可选 BYOK 请求头（优先级高于服务端 env，不会写入日志/响应）：

| Header | 映射 |
| --- | --- |
| `x-github-token` | `GITHUB_TOKEN` |
| `x-llm-api-key` | `LLM_API_KEY` |
| `x-llm-base-url` | `LLM_BASE_URL` |
| `x-llm-model` | `LLM_MODEL` |

内部调用可带 `Authorization: Bearer $WEBHOOK_SECRET` 或 `x-webhook-secret`（仅当服务端配置了 `WEBHOOK_SECRET` 且值不匹配时返回 401）。紧急开关：`GOSSIP_REQUIRE_WEBHOOK_SECRET=1` 恢复「生产必须校验密钥」。CORS：`GOSSIP_CORS_ORIGINS`（逗号分隔）或 `*`。

公开路径带进程内限流与短时缓存（多实例不共享）：**先查缓存再计限流**；超限返回 `429` + `Retry-After`。可用 `GOSSIP_RATE_LIMIT_IP_PER_HOUR`（默认 30）、`GOSSIP_RATE_LIMIT_REPO_PER_HOUR`（默认 60）、`GOSSIP_CACHE_TTL_SEC`（默认 600）调整；响应头 `X-Cache: HIT|MISS`。内部 Bearer 调用跳过 IP 限流。`days` 限制在 1–90。

---

## 部署

### 生产入口怎么选

| 入口 | 说明 |
|------|------|
| **Vercel（API + Web）** | 根目录 `npx vercel`：静态站来自 `apps/web` 构建，`/api/*` 走 Serverless。浏览器「出报」打同源 `/api/gossip`。 |
| **Chrome 扩展（开源 sideload）** | 仓库内 `apps/extension`：Chrome「加载已解压的扩展程序」；Options 填 API Base URL 与可选 BYOK。不上架商店。 |
| **常驻 Bot** | Discord / Telegram：`npm run bot`（Railway 等）。**Discord Interactions webhook（`/api/discord`）仍为 501**，请用长驻 Bot，不要配 Interactions Endpoint。 |

### Vercel

根目录直接 `npx vercel`（`api/` 在仓库根；`vercel.json` 构建 Web 静态资源）。Dashboard 建议填入：

- `GITHUB_TOKEN` / `LLM_API_KEY`（按需；也可用 BYOK 头）
- `WEBHOOK_SECRET`（可选，供内部调用；默认不强制）
- `GOSSIP_REQUIRE_WEBHOOK_SECRET` / `GOSSIP_CORS_ORIGINS`（按需）
- Bot 相关：`TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`，或飞书三件套

无 LLM 演示可设 `GOSSIP_OFFLINE=1`。

### Railway / 常驻 Bot

```bash
npm install
DISCORD_BOT_TOKEN=xxx TELEGRAM_BOT_TOKEN=xxx npm run bot
```

---

### Chrome 扩展（开源加载）

见 [`apps/extension/README.md`](apps/extension/README.md)：开发者模式加载 `apps/extension`，在 GitHub 仓库页点「八卦小报」。不上架应用商店；可打包 `.crx` 分发。

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
