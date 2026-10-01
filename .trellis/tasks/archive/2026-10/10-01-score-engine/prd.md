# 含金量评分引擎

## Goal

让 repo-gossip 从「项目八卦小报」升级为「GitHub 仓库含金量衡量工具」：新增可解释的五维评分引擎（影响力 / 活跃度 / 社区 / 工程 / 信用度），输出 0-100 总分、等级、置信度与逐项证据。八卦模式原样保留，评分是新增的第二条管线。

## Background

现有分析（`analyzer.ts`）只有娱乐性信号：4 档体温、趣味奖项。要衡量「含金量」，需要全历史、归一化、可解释的量化评分。市面对标：OpenSSF Scorecard（工程检查清单+逐项证据）、CHAOSS（Bus Factor / 响应时长等社区指标定义）、npms（分项+加权综合分）、OSSInsight（对标百分位）。本任务是 P0：评分引擎 MVP，先不做 star 时间线反刷星（见 `10-01-star-watermark`）与徽章端点（`10-01-score-badge`）。

## Requirements

1. **新模块 `packages/core/src/score.ts`**：纯函数评分，无网络调用。输入 `RepoScoreInput`，输出 `RepoScore`。
2. **五维评分**，各 0-100，加权合成总分（默认权重各 0.2）：
   - **影响力**：star（对数刻度）、fork/star 比健康区间、watcher（subscribers）
   - **活跃度**：近 12 周周均 commit、近期动能（近 4 周 vs 前 8 周）、90 天合并 PR 数、90 天发版数
   - **社区**：贡献者数量、Bus Factor（CHAOSS 定义：覆盖 50% 贡献量所需的最少人数，≤2 高危）、issue 关闭吞吐
   - **工程**：二值清单（license / README / CI workflows / CONTRIBUTING / SECURITY.md / 30 天内有过 push），参考 OpenSSF Scorecard 子集
   - **信用度**：比例健全性检查（star-engagement 比、star/贡献者比、高星低活、fork/star 过低），每项 ok/warn/fail，扣分制；P1 由 star 时间线突发检测增强
3. **可解释**：每个维度输出证据行（中文，含原始数字）；每个子信号缺失时记录 `missing` 并把该维度权重重分配到其余维度（权重重归一化）。
4. **置信度**：缺失重信号（commit 活跃度、贡献者、Search API 计数）各 −15，清单项未知 −10，下限 20；标签 充分/尚可/不足。
5. **等级**：≥85 足金 🥇 / 70-84 K金 🥈 / 55-69 镀金 🥉 / 40-54 掺水 ⚠️ / <40 贴纸 🧻。
6. **数据抓取 `packages/core/src/github-score.ts`**：`repos.get`、`/stats/commit_activity`（202=计算中，短暂重试一次后降级 null）、`listContributors`（首页 100，`truncated` 标记）、Search API 数 90 天合并 PR 与已关 issue（未配 token 时 Search 限额低，失败降级 null）、`.github/workflows` 目录探测、README/CONTRIBUTING/SECURITY 探测（404 容忍）、`listReleases`（per_page=20 过滤 90 天）。**每个请求独立软失败**，收集 `missing` 信号列表，遵循 error-handling.md 的降级语义（不整单失败）。预算 ≤11 次调用/份。
7. **编排 `runScore(options)`**（加入 `gossip.ts`）：fetch → score → `formatScoreCard`（markdown/plain），返回 `{ score, message, missing }`；P0 不接 LLM（模板即终稿）。
8. **入口**：
   - CLI：`--score` 标志输出评分卡。
   - HTTP：`POST /api/gossip` 增加 `mode: "score"`，返回评分卡 payload；限流/缓存/BYOK 复用现有管道。
   - Web：出报表单加「出报 / 验金」切换，新增评分卡视图（沿用暗色编辑部风格）。
9. **契约**：不改 `runGossip` 既有签名与 `RepoSnapshot` 形状；新符号从 `index.ts` 导出。
10. **登记**：`.env.example` / README 增补 `--score` 与 `mode:"score"` 说明。

## Acceptance Criteria

- [x] 纯函数单测：五维各自打分边界（0/满分）、权重重分配、Bus Factor 计算、sanity 扣分、置信度下限 20。
- [x] 打桩 octokit 单测：`/stats/*` 返回 202 时重试后降级；任一子请求失败不影响整体出分，`missing` 正确记录。
- [x] `formatScoreCard` 输出含总分、等级 emoji、五维证据行、置信度。
- [x] `npm test` 与 `npm run typecheck -w @repo-gossip/core`（及 web）全绿。
- [x] CLI 冒烟：`npm run gossip -- vercel/next.js --score --offline`（评分不依赖 LLM，离线可用）。
- [x] Web 冒烟：切换「验金」可见评分卡；出报模式回归不受影响。

## Out of Scope

- star 时间线突发反刷星（`10-01-star-watermark`）
- SVG 徽章端点（`10-01-score-badge`）
- 仓库对比、英文 i18n（`10-01-compare-i18n`）
- LLM 解读评分（后续单独任务）
- 同语言/同规模真实百分位（需 cohort 预计算，先用对数刻度校准阈值代替，已在 PRD 注明）

## Key Decisions

| 决策 | 结论 |
|------|------|
| 评分与八卦的关系 | 两条并行管线，共用 octokit/限流/缓存；不改动现有出报路径 |
| 权重 | 五维各 0.2 起步，常量集中在 score.ts 顶部便于调整 |
| 百分位 | P0 用对数刻度阈值；真实 cohort 百分位进 P2 |
| Bus Factor 来源 | `listContributors` 首页 100 的 contributions 分布 |
| 信用度 P0 版 | 比例 sanity 检查扣分制；突发检测留给 P1 |
| LLM | P0 不接；评分卡模板直出，避免幻觉数字 |
