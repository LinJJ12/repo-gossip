# 实现记录 — 含金量评分引擎（2026-10-01）

## 代码改动

| 文件 | 内容 |
|------|------|
| `packages/core/src/score.ts`（新增） | 五维纯函数评分：`RepoScoreInput` → `RepoScore`。子信号→维度→总分三级加权 + 权重重分配；`logScale`/`ratioScale`/`forkStarScore`/`busFactorOf`/`momentumOf`/`gradeFor`/`confidenceFromMissing` 全部可单测；`formatScoreCard` 中文评分卡排版 |
| `packages/core/src/github-score.ts`（新增） | 评分数据抓取（≤13 次调用）：`repos.get` 硬依赖，其余逐路软失败登记 `missing`；`/stats/commit_activity` 202 递增重试（1.5s/2.5s）+ 204 合法零值；README 走 `getReadme`（大小写/扩展名宽容）；CONTRIBUTING/SECURITY 由根目录 + `.github` 两份目录清单大小写不敏感匹配；CI 以 `.github/workflows` 内容为准 |
| `packages/core/src/gossip.ts` | 新增 `runScore(options)` 编排（fetch → compute → format），支持注入 octokit 供测试；与 `runGossip` 完全并行 |
| `packages/core/src/index.ts` | 导出评分符号 |
| `packages/core/src/cli.ts` | `--score` 标志（`--json` 可输出原始评分 JSON） |
| `api/gossip.ts` | `mode:"score"`（body/query）→ `{kind:"score", score, message, missing}`；缓存键含 `format:"score"`，限流/BYOK 复用 |
| `apps/web/vite.config.ts` | dev 中间件同等支持 `mode:"score"` |
| `apps/web/src/types.ts` / `ScoreView.tsx`（新增）/ `App.tsx` / `styles.css` | 「出报/验金」切换 + 金铺检定卡视图（总分 hero、五维进度条、健全性清单、置信度） |
| `test/score.test.ts` / `test/github-score-fetch.test.ts`（新增） | 38 例：刻度函数边界、Bus Factor、动能、权重重分配、sanity 扣分、202/204/软失败降级、truncated、端到端 `runScore` 注入打桩 |
| `README.md` / `docs/architecture.md` | 登记评分管线、CLI/API 用法、数据流图 |

## 冒烟（真实 GitHub）

- `npm run gossip -- vercel/next.js --score` → **95/100 足金 🥇**（影响力 96 / 活跃度 93 / 社区 98 / 工程 90 / 信用度 100，置信度 100）
- `npm run gossip -- sindresorhus/is --score` → **63/100 镀金 🥉**（Bus Factor 1 ⚠️、高星低活 ⚠️ 被正确点名）
- 首轮冒烟暴露 4 个问题并已修复：
  1. README 精确路径探测误报（`sindresorhus/is` 用小写 `readme.md`）→ 改用 `getReadme`
  2. CONTRIBUTING/SECURITY 漏检 `.github/` 下的文件 → 根目录 + `.github` 目录清单（next.js 的小写 `contributing.md` 正确命中）
  3. `/stats/commit_activity` 202 重试 1.2s 不够 → 递增重试（1.5s/2.5s），204 视为合法零值
  4. sanity 全通过时维度行误挂 ⚠️ 图标 → 仅展示 warn/fail，全过显示「各项比例检查均通过」

## 验证

- `npm test`：143 pass / 0 fail（新增 38 例）
- `npm run typecheck`（core/bot/web）全绿
- `npm run web:build` 通过

## 已知限制 / 后续

- `search.issuesAndPullRequests` 有 Octokit 弃用 stderr 提示（端点仍工作，无功能影响）
- 未配 token 时 Search API 限额 10/min，三路计数可能整组降级（已按 missing 降权处理）
- 百分位为对数刻度近似；真实 cohort 百分位、LLM 解读、含水量时间线检测见后续任务
- `.env.example` 无需新增变量（评分不引入新配置）
