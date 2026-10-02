# Architecture

Monorepo layout inspired by common GitHub bot + web projects
([OctoBot](https://github.com/gabrielccarvalho/octobot)-style `apps/` + `packages/`,
with Vercel `api/` kept at the repo root like Probot apps).

```
repo-gossip/
├── packages/core/     # Gossip engine: GitHub · analyzer · LLM · format · CLI
├── apps/
│   ├── web/           # Vite React preview
│   ├── bot/           # Discord / Telegram / Feishu long-running process
│   └── extension/     # Chrome MV3 sideload extension
├── api/               # Vercel Serverless entrypoints (thin adapters)
├── test/              # Unit tests for core
├── docs/              # Design notes
├── package.json       # npm workspaces root
└── .env.example
```

## Data flow

```
repo URL
  → packages/core
       fetch: commits + PR / Issue / Release（窗口内；活动抓取失败则降级）
              commit 详情（增删行/改动文件）按 GOSSIP_MAX_COMMIT_DETAILS 预算采样，
              其余 commit 保留列表级信息（additions/deletions=0、files=[]），不计入 statsIncomplete
       analyze → LLM / offline → tabloid（新信号织入既有栏目，不新增独立章节）
  → apps/web | apps/bot | api/* | apps/extension
```

### Score pipeline（并行于 gossip 管线）

```
repo URL → runScore（gossip.ts）
     → fetchRepoScoreInput（github-score.ts，基础 11 次调用，star ≥ 500 时加抓 stargazer 时间线最多 +4 次；
        除 repos.get 外逐路软失败 → missing 信号）
        repos.get · /stats/commit_activity（202 重试）· listContributors（≤100）
        Search×3（90d 合并 PR / 90d 关闭 issue / 开放 issue）· listReleases（90d）
        getReadme · 根目录与 .github 目录清单（CONTRIBUTING/SECURITY，大小写宽容）· .github/workflows
     → computeRepoScore（score.ts，纯函数：五维 = 影响力/活跃度/社区/工程/信用度，
        子信号缺失 → 维度内权重重分配；维度缺失 → 五维间重分配；
        置信度按 missing 扣减，下限 20；
        信用度 = 比例健全性检查 + 含水量（watermark.ts：star 时间线突发 + 比例异常，×0.6 折算扣分））
     → formatScoreCard → { score, message, missing }
  入口：CLI --score · POST /api/gossip {mode:"score", lang?} · Web「验金」
  徽章：GET /api/badge/:owner/:repo.svg（缓存优先，任何失败输出灰色 N/A、HTTP 200，?lang=en 英文）
  LLM 不参与评分（模板直出，防幻觉数字）。
```

### Compare pipeline（评分的多仓库版）

```
repos[2-4] → runCompare（gossip.ts）
     → 逐仓库并行 fetchRepoScoreInput + computeRepoScore（口径一致；单个失败 → N/A 列，不拖垮整表）
     → formatCompareTable（Markdown 对照表：总分/五维/置信度/含水量）
     → formatCompareRadarSvg（五维雷达 SVG，等级配色，core 与 Web 各自渲染同一几何）
  入口：CLI --compare（positionals 全为仓库，--lang en 切英文）
        POST /api/gossip {mode:"compare", repos:[...], lang?} · Web 验金输入框逗号分隔多仓库
```

### Client-side history（不经服务端）

| Surface | Store | Notes |
|---------|--------|--------|
| Web「最近」 | `localStorage` · `repoGossipHistory` | 最多 20；与扩展不同步 |
| Extension「最近」 | `chrome.storage.local` · `repoGossipHistory` | 侧边栏 / 弹层 / 完整页共用；写入经 background `HISTORY_UPSERT` |

Secrets (`GITHUB_TOKEN`, `LLM_API_KEY`, bot tokens, optional `WEBHOOK_SECRET`) live only in root
`.env` or host env vars — never in the frontend bundle. Per-request BYOK headers
(`x-github-token`, `x-llm-api-key`, `x-llm-base-url`, `x-llm-model`) override server env for that
call only and must never be logged or echoed.

### `/api/gossip` auth (public by default)

- Browser / extension callers do **not** need `WEBHOOK_SECRET`.
- If `WEBHOOK_SECRET` is set and the request sends a non-matching `Authorization: Bearer` or
  `x-webhook-secret`, respond `401`.
- Optional internal callers may send a matching secret.
- Kill-switch: `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` restores the old “require secret in production”
  behavior.
- CORS: `OPTIONS` + `GOSSIP_CORS_ORIGINS` (comma-separated) or `*` for `Access-Control-Allow-Origin`.
- All gossip/badge business logic (routing, validation, auth, rate limit, cache, 500 sanitization)
  lives in core `http-api.ts`; `api/*.ts` and the Vite dev middleware are thin protocol adapters.
- In-process rate limits (`GOSSIP_RATE_LIMIT_*_PER_HOUR`) and TTL cache (`GOSSIP_CACHE_TTL_SEC`);
  multi-instance deployments do not share this state. Internal Bearer calls skip the IP bucket.
  Cache is checked **before** rate-limit consume; keys include `format`. Responses may include
  `X-Cache: HIT|MISS` and `429` + `Retry-After` when limited. `days` is clamped to 1–90.
- `/api/badge` has its own IP bucket (`GOSSIP_RATE_LIMIT_BADGE_PER_HOUR`, default 60/h): each cache
  miss costs 11–15 GitHub API calls. Rate-limited and failed badge requests still return HTTP 200
  with the gray N/A SVG (README images never break); limited responses use `Cache-Control: no-store`
  so the CDN cannot poison the real badge.
- 500 responses are sanitized to `{"error":"internal error"}`; details go to server logs only.
- BYOK `x-llm-base-url` must pass `isAllowedLlmBaseUrl` (blocks cloud metadata / non-http(s)).

Production checklist:

- Optional: `WEBHOOK_SECRET` for internal callers; `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` only if you
  want to force auth again
- Optional: `GOSSIP_CORS_ORIGINS` for browser origins
- Optional: rate-limit / cache env vars (see `.env.example`)
- Set `TELEGRAM_WEBHOOK_SECRET` if using `/api/telegram`
- Set `FEISHU_VERIFICATION_TOKEN` if using `/api/feishu`
- Prefer `npm run bot` for Discord — `/api/discord` returns **501** until Ed25519
Interactions verification lands; do not point Discord’s Interactions Endpoint at it.
