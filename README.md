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

兼容任意 OpenAI Chat Completions 接口（OpenAI / DeepSeek / 硅基流动 / 代理等）：

```env
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
GITHUB_TOKEN=ghp_...   # 可选；提高限额或读私有仓
```

---

## 架构

```
仓库链接
   │
   ▼
GitHub API (@octokit/rest) ──► 近 N 天 commits + 行数统计
   │
   ▼
本地分析器 ──► 体温 / 颁奖 / 彩蛋 / 提名提交
   │
   ▼
LLM（可关闭）──► 大片标题 · 废话翻译 · 收束金句
   │
   ▼
富文本 / Discord Embed / 飞书卡片
```

| 路径 | 用途 |
|------|------|
| `src/core/*` | 拉取、分析、生成、排版 |
| `src/platforms/*` | Discord / Telegram / 飞书 |
| `src/cli.ts` | 命令行小报 |
| `api/*` | Vercel Serverless Webhook |

---

## Bot 接入

### Telegram

1. 找 [@BotFather](https://t.me/BotFather) 创建 Bot，拿到 `TELEGRAM_BOT_TOKEN`
2. 本地轮询：

```bash
TELEGRAM_BOT_TOKEN=xxx npm start
```

3. 或 Vercel：部署后把 Webhook 设为 `https://<你的域名>/api/telegram`

```bash
curl "https://api.telegram.org/bot<token>/setWebhook?url=https://<domain>/api/telegram"
```

群里发送 `/gossip owner/repo` 或直接丢 GitHub 链接。

### Discord

1. [Discord Developer Portal](https://discord.com/developers/applications) 创建应用 → Bot → Copy Token
2. OAuth2 邀请 Bot（scope: `bot` + `applications.commands`）
3. 常驻运行（推荐）：

```bash
DISCORD_BOT_TOKEN=xxx npm start
```

上线后使用 slash 命令：`/gossip repo:owner/repo`

### 飞书

1. 飞书开放平台创建企业自建应用，开通机器人能力
2. 事件订阅请求网址：`https://<domain>/api/feishu`
3. 配置环境变量：`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_VERIFICATION_TOKEN`
4. 在群里 @机器人 并发送仓库地址

### HTTP API

```bash
curl "https://<domain>/api/gossip?repo=vercel/next.js&offline=1"
curl -X POST https://<domain>/api/gossip \
  -H "content-type: application/json" \
  -d '{"repo":"vercel/next.js","format":"feishu"}'
```

`format`：`markdown`（默认）| `json` | `discord` | `feishu`

---

## 部署

### Vercel

```bash
npx vercel
# 在 Dashboard 填入 LLM_API_KEY、TELEGRAM_BOT_TOKEN 等
```

无 LLM 演示可设 `GOSSIP_OFFLINE=1`。

### Railway / 任意 Node 主机

```bash
npm run build
DISCORD_BOT_TOKEN=xxx TELEGRAM_BOT_TOKEN=xxx node dist/index.js
```

---

## 开发

```bash
cp .env.example .env
npm install
npm run gossip -- owner/repo --offline
npm run typecheck
```

---

## 为什么适合开源

- **零重依赖**：不需要 FFmpeg，GitHub + LLM 就够
- **部署简单**：CLI 本地玩，Serverless 24h 在线
- **流量密码**：每人都会拿自己的仓来被吐槽一次

欢迎 PR：更多彩蛋规则、周报定时推送、GitLab / Gitee 源、多语言小报……

## License

MIT
