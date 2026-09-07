# repo-gossip

把 GitHub 仓库链接丢进去，拿到一份 **「项目八卦小报」**——不是 changelog，是气氛组。

基于 **GitHub API +（可选）LLM**，支持 CLI、Web 预览站、Chrome 扩展，以及 Discord / Telegram / 飞书 Bot。可部署到 Vercel / Railway。

| | |
|---|---|
| **许可证** | [MIT](LICENSE) |
| **运行时** | Node.js ≥ 18 |
| **包管理** | npm workspaces |

---

## 目录

- [功能一览](#功能一览)
- [快速开始](#快速开始)
- [使用方式](#使用方式)
  - [Web 预览站](#1-web-预览站)
  - [CLI](#2-cli)
  - [Chrome 扩展](#3-chrome-扩展推荐本地试用)
  - [即时通讯 Bot](#4-即时通讯-bot)
  - [HTTP API](#5-http-api)
- [环境变量](#环境变量)
- [仓库结构](#仓库结构)
- [开发与 CI](#开发与-ci)
- [部署](#部署)
- [安全说明](#安全说明)
- [License](#license)

---

## 功能一览

| 板块 | 说明 |
|------|------|
| 本周大片标题 | 把近期提交写成「影评式」标题 |
| 颁奖典礼 | 卷王、夜猫子等趣味奖项 |
| 项目体温 | 活跃度一眼可读 |
| 提交信翻译 | 把 commit message 翻译成八卦文案 |
| 彩蛋侦探 | 抓可疑调试痕迹等梗 |

无 LLM 时也可用本地模板出报（`--offline` / 扩展勾选「仅本地模板」）。

---

## 快速开始

```bash
git clone https://github.com/LinJJ12/repo-gossip.git
cd repo-gossip
cp .env.example .env   # 按需填写 LLM / GitHub Token
npm install
npm run web
```

浏览器打开 [http://localhost:5173](http://localhost:5173)，粘贴 `owner/repo` 或 GitHub URL 即可出报。

不想起 Web 时：

```bash
npm run gossip -- vercel/next.js --offline
```

---

## 使用方式

### 1. Web 预览站

适合本地预览或部署到 Vercel 后给同事试用。

```bash
npm run web          # 开发：http://localhost:5173
npm run web:build    # 生产构建
```

页面上可调回溯天数、是否调用 LLM；请求打到同源 `/api/gossip`（开发时由 Vite 中间件提供）。

### 2. CLI

```bash
npm run gossip -- owner/repo
npm run gossip -- https://github.com/owner/repo --days 14
npm run gossip -- owner/repo --offline
```

### 3. Chrome 扩展（推荐本地试用）

仓库内自带开源 MV3 扩展（**不经过 Chrome 应用商店**，用「加载已解压的扩展程序」安装）。详细步骤见：

**→ [apps/extension/README.md](apps/extension/README.md)**

摘要：

1. 先保证有可访问的八卦 API（本地：`npm run web` → `http://localhost:5173`，或你的 Vercel 域名）。
2. Chrome 打开 `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选择本仓库的 `apps/extension` 目录。
3. 点击工具栏图标：在 **360px 弹层**里粘贴仓库地址出报；可进「设置」填写 API Base URL 与可选 BYOK。
4. 打开任意 GitHub 仓库页：右上角可拖动的「八卦小报」按钮，点击即可出报。
5. 弹层内「完整页面」可打开大屏阅读界面。

密钥只保存在本机 `chrome.storage.local`，出报时通过请求头发给你配置的 API，不写入本仓库服务端数据库。

### 4. 即时通讯 Bot

#### Telegram

1. [@BotFather](https://t.me/BotFather) 创建 Bot，取得 `TELEGRAM_BOT_TOKEN`
2. 本地轮询：`TELEGRAM_BOT_TOKEN=xxx npm run bot`
3. 或配置 Webhook：`https://<域名>/api/telegram`（建议同时设 `TELEGRAM_WEBHOOK_SECRET`）

#### Discord

```bash
DISCORD_BOT_TOKEN=xxx npm run bot
```

使用斜杠命令 `/gossip repo:owner/repo`。  
**注意：** `/api/discord` Interactions Webhook 仍为 501，请用常驻 Bot，不要配置 Interactions Endpoint。

#### 飞书

事件订阅 URL：`https://<域名>/api/feishu`  
配置：`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_VERIFICATION_TOKEN`

### 5. HTTP API

```bash
curl -X POST https://<domain>/api/gossip \
  -H "content-type: application/json" \
  -d '{"repo":"vercel/next.js","format":"web","offline":true}'
```

| 字段 | 说明 |
|------|------|
| `repo` | `owner/repo` 或 GitHub URL |
| `format` | `web`（默认）\| `markdown` \| `json` \| `discord` \| `feishu` |
| `days` | 1–90，回溯窗口 |
| `offline` | `true` 时不调 LLM |

可选 **BYOK** 请求头（优先于服务端环境变量，不会写入日志/响应体）：

| Header | 映射 |
|--------|------|
| `x-github-token` | `GITHUB_TOKEN` |
| `x-llm-api-key` | `LLM_API_KEY` |
| `x-llm-base-url` | `LLM_BASE_URL` |
| `x-llm-model` | `LLM_MODEL` |

内部调用可带 `Authorization: Bearer $WEBHOOK_SECRET` 或 `x-webhook-secret`。公开路径有进程内限流与短时缓存；详见环境变量表。

---

## 环境变量

复制 [`.env.example`](.env.example) 为 `.env`。常用项：

| 变量 | 说明 |
|------|------|
| `GITHUB_TOKEN` | 可选；提高限额 / 读私有仓 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 兼容 OpenAI Chat Completions 的服务 |
| `GOSSIP_OFFLINE` | `1` 时强制本地模板 |
| `WEBHOOK_SECRET` | 可选；内部调用校验 |
| `GOSSIP_REQUIRE_WEBHOOK_SECRET` | `1` 时生产必须校验密钥 |
| `GOSSIP_CORS_ORIGINS` | CORS，逗号分隔或 `*` |
| `GOSSIP_RATE_LIMIT_*` / `GOSSIP_CACHE_TTL_SEC` | 公开 API 限流与缓存 |

Bot 相关变量见 `.env.example` 注释。

---

## 仓库结构

```
repo-gossip/
├── packages/core/     # 八卦引擎：GitHub · 分析 · LLM · 排版 · CLI
├── apps/
│   ├── web/           # Vite + React 预览站
│   ├── bot/           # Discord / Telegram / 飞书常驻进程
│   └── extension/     # Chrome MV3 扩展（sideload）
├── api/               # Vercel Serverless 入口
├── test/              # 核心单测
├── docs/              # 架构说明
└── package.json
```

架构细节：[docs/architecture.md](docs/architecture.md)

---

## 开发与 CI

```bash
npm install
npm test              # 核心单测
npm run typecheck     # core / bot / web
npm run gossip -- owner/repo --offline
```

| 命令 | 说明 |
|------|------|
| `npm run gossip -- …` | CLI 出报 |
| `npm run web` | 预览站 |
| `npm run bot` | 长连接 Bot |
| `npm test` | 单测 |
| `npm run typecheck` | 类型检查 |

Push / PR 会跑 `npm test` 与 `npm run typecheck`（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。

---

## 部署

| 入口 | 说明 |
|------|------|
| **Vercel（Web + API）** | 根目录 `npx vercel`；静态站来自 `apps/web`，`/api/*` 为 Serverless |
| **Chrome 扩展** | 加载 `apps/extension`；API Base URL 指向你的后端 |
| **常驻 Bot** | `npm run bot`（Railway 等） |

Vercel Dashboard 建议配置：`GITHUB_TOKEN`、`LLM_API_KEY`（或依赖 BYOK）、按需 `WEBHOOK_SECRET` / CORS / 限流相关变量。无 LLM 演示可设 `GOSSIP_OFFLINE=1`。

---

## 安全说明

- 不要把 `WEBHOOK_SECRET`、LLM Key、GitHub Token 写进扩展源码或提交进 Git。
- 扩展 BYOK 仅存用户本机；请求经你配置的 API Base URL 发出。
- 公开 `/api/gossip` 默认可不带 Webhook 密钥；生产若需强制鉴权，设 `GOSSIP_REQUIRE_WEBHOOK_SECRET=1`。

---

## License

[MIT](LICENSE)
