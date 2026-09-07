# repo-gossip

> 把 GitHub 仓库链接丢进去，拿走一份 **「项目八卦小报」** —— 不是 changelog，是气氛组。

基于 **GitHub API +（可选）LLM**：CLI、Web 预览站、Chrome 扩展，以及 Discord / Telegram / 飞书 Bot。可一键部署到 Vercel / Railway。

<p align="left">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="package.json"><img alt="Node.js" src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg"></a>
  <a href="package.json"><img alt="npm workspaces" src="https://img.shields.io/badge/npm-workspaces-cb3837.svg"></a>
</p>

---

## 小报里有什么

| | |
|---|---|
| **本周大片标题** | 近期提交写成「影评式」标题 |
| **颁奖典礼** | 卷王、夜猫子等趣味奖项 |
| **项目体温** | 活跃度一眼可读 |
| **提交信翻译** | commit message → 八卦文案 |
| **彩蛋侦探** | 可疑调试痕迹等梗 |

没有 LLM 也能出报：CLI 加 `--offline`，Web / 扩展关掉「调用 LLM」或勾选「仅本地模板」。

---

## 30 秒上手

```bash
git clone https://github.com/LinJJ12/repo-gossip.git
cd repo-gossip
cp .env.example .env   # 按需填 GITHUB_TOKEN / LLM_*
npm install
npm run web
```

打开 [http://localhost:5173](http://localhost:5173)，粘贴 `owner/repo` 或 GitHub URL → **出报**。

只要终端也行：

```bash
npm run gossip -- vercel/next.js --offline
```

---

## 入口一览

| 入口 | 适合 | 命令 / 路径 |
|------|------|-------------|
| **Web** | 本地预览、给同事试用 | `npm run web` |
| **CLI** | 脚本 / 终端 | `npm run gossip -- owner/repo` |
| **Chrome 扩展** | 日常刷 GitHub | [`apps/extension`](apps/extension/README.md) |
| **Bot** | 群里随手问 | `npm run bot` |
| **HTTP API** | 自建集成 | `POST /api/gossip` |

---

## 使用说明

### Web 预览站

```bash
npm run web          # http://localhost:5173
npm run web:build    # 生产构建
```

- 可调回溯天数、是否调用 LLM
- 请求走同源 `/api/gossip`（开发时由 Vite 中间件提供）
- 出报成功后可点 **「最近」**，在本机回看缓存小报（`localStorage`，最多 20 条；与扩展不同步）

### CLI

```bash
npm run gossip -- owner/repo
npm run gossip -- https://github.com/owner/repo --days 14
npm run gossip -- owner/repo --offline
```

### Chrome 扩展

开源 MV3，**不上架应用商店**——用「加载已解压的扩展程序」安装。

完整步骤 → **[apps/extension/README.md](apps/extension/README.md)**

摘要：

1. 先有可访问的 API（本地 `npm run web`，或你的 Vercel 域名）
2. `chrome://extensions` → 开发者模式 → 加载 `apps/extension`
3. 工具栏弹层粘贴仓库出报；GitHub 仓库页有可拖动的「八卦小报」按钮
4. **「最近」** 在弹层 / 完整页 / 侧边栏共用同一份本机历史（`chrome.storage.local`）

### 即时通讯 Bot

<details>
<summary><strong>Telegram</strong></summary>

1. [@BotFather](https://t.me/BotFather) 创建 Bot，取得 `TELEGRAM_BOT_TOKEN`
2. 本地轮询：`TELEGRAM_BOT_TOKEN=xxx npm run bot`
3. 或 Webhook：`https://<域名>/api/telegram`（建议同时设 `TELEGRAM_WEBHOOK_SECRET`）

</details>

<details>
<summary><strong>Discord</strong></summary>

```bash
DISCORD_BOT_TOKEN=xxx npm run bot
```

斜杠命令：`/gossip repo:owner/repo`

> `/api/discord` Interactions Webhook 仍为 **501**。请用常驻 Bot，不要配置 Interactions Endpoint。

</details>

<details>
<summary><strong>飞书</strong></summary>

- 事件订阅：`https://<域名>/api/feishu`
- 配置：`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_VERIFICATION_TOKEN`

</details>

### HTTP API

```bash
curl -X POST https://<domain>/api/gossip \
  -H "content-type: application/json" \
  -d '{"repo":"vercel/next.js","format":"web","offline":true}'
```

| 字段 | 说明 |
|------|------|
| `repo` | `owner/repo` 或 GitHub URL |
| `format` | `web`（默认）· `markdown` · `json` · `discord` · `feishu` |
| `days` | 1–90 |
| `offline` | `true` 时不调 LLM |

可选 **BYOK** 请求头（优先于服务端环境变量，不落日志 / 响应体）：

| Header | 映射 |
|--------|------|
| `x-github-token` | `GITHUB_TOKEN` |
| `x-llm-api-key` | `LLM_API_KEY` |
| `x-llm-base-url` | `LLM_BASE_URL` |
| `x-llm-model` | `LLM_MODEL` |

内部调用可带 `Authorization: Bearer $WEBHOOK_SECRET` 或 `x-webhook-secret`。公开路径有进程内限流与短时缓存。

---

## 环境变量

复制 [`.env.example`](.env.example) → `.env`。常用项：

| 变量 | 说明 |
|------|------|
| `GITHUB_TOKEN` | 提高限额 / 读私有仓 |
| `LLM_API_KEY` · `LLM_BASE_URL` · `LLM_MODEL` | 兼容 OpenAI Chat Completions |
| `GOSSIP_OFFLINE` | `1` 强制本地模板 |
| `WEBHOOK_SECRET` | 内部调用校验（可选） |
| `GOSSIP_REQUIRE_WEBHOOK_SECRET` | `1` 时生产强制鉴权 |
| `GOSSIP_CORS_ORIGINS` | CORS，逗号分隔或 `*` |
| `GOSSIP_RATE_LIMIT_*` · `GOSSIP_CACHE_TTL_SEC` | 限流与缓存 |

Bot 相关变量见 `.env.example` 注释。

---

## 仓库结构

```text
repo-gossip/
├── packages/core/     # 八卦引擎：GitHub · 分析 · LLM · 排版 · CLI
├── apps/
│   ├── web/           # Vite + React 预览站（含本机「最近」）
│   ├── bot/           # Discord / Telegram / 飞书
│   └── extension/     # Chrome MV3（sideload）
├── api/               # Vercel Serverless
├── test/              # 单测
├── docs/              # 架构说明
└── package.json
```

更多：[docs/architecture.md](docs/architecture.md)

---

## 开发

```bash
npm install
npm test
npm run typecheck
npm run gossip -- owner/repo --offline
```

| 命令 | 作用 |
|------|------|
| `npm run gossip -- …` | CLI 出报 |
| `npm run web` | 预览站 |
| `npm run bot` | 长连接 Bot |
| `npm test` | 单测 |
| `npm run typecheck` | 类型检查 |

CI：Push / PR 跑 `npm test` 与 `npm run typecheck`（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。

---

## 部署

| 入口 | 怎么做 |
|------|--------|
| **Vercel**（Web + API） | 根目录 `npx vercel`；静态来自 `apps/web`，`/api/*` 为 Serverless |
| **Chrome 扩展** | 加载 `apps/extension`；API Base URL 指向你的后端 |
| **常驻 Bot** | `npm run bot`（Railway 等） |

建议在宿主环境配置 `GITHUB_TOKEN`、`LLM_API_KEY`（或依赖 BYOK）。纯演示可设 `GOSSIP_OFFLINE=1`。

---

## 安全

- 不要把 `WEBHOOK_SECRET`、LLM Key、GitHub Token 写进扩展源码或提交进 Git
- 扩展 BYOK 只存在本机；请求只发往你配置的 API Base URL
- 公开 `/api/gossip` 默认可不带 Webhook 密钥；生产若要强制鉴权，设 `GOSSIP_REQUIRE_WEBHOOK_SECRET=1`
- Web「最近」与扩展「最近」互不同步（浏览器存储隔离）

---

## License

[MIT](LICENSE)

---

## 致谢

感谢 [LINUX DO](https://linux.do) 社区的推广支持，以及佬友们的反馈。
