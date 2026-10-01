# 含水量检测（反刷星信号）

## Goal

把「信用度」维度从 P0 的比例 sanity 检查升级为真正的反刷星检测：通过 stargazer 时间线突发分析与跨信号比例异常，输出仓库「含水量」估计（百分比 + 证据），直接回应市面上 6M 假 star 的现实（参考 StarScout 研究，arXiv:2412.13459）。

## Requirements

1. **star 时间线抓取**：`GET /repos/{o}/{r}/stargazers` + `Accept: application/vnd.github.star+json`（带 `starred_at`），前 4 页（≤400 个）按页抓取，独立软失败降级。
2. **突发检测（纯函数，可单测）**：按天/周聚合 starred_at；若某窗口 star 数 ≥ 该序列基线（前序均值 + 3σ，或 IQR 上界）且绝对值 ≥ 阈值（如单日 ≥ 40），标记疑似刷量窗口，给出 `{ start, end, count, suspicion }` 证据列表。
3. **比例异常并入**：复用 P0 sanity 检查的 warn/fail 信号，与突发窗口合成 `watermark`（含水量 0-100% 与分级：干净/存疑/高危）。
4. **呈现**：评分卡信用度维度追加「含水量」行与证据；尽调语气不得指控具体账号，只描述模式。
5. **API 成本**：仅在评分模式且仓库 star ≥ 500 时抓时间线（小仓库无刷量价值，省限额）。

## Acceptance Criteria

- [ ] 纯函数单测：正常增长序列不误报；注入单日尖峰可检出；空/短序列降级。
- [ ] 评分卡集成后 `npm test`、typecheck 全绿；`--score` 冒烟对高星仓库可见含水量行。
- [ ] stargazers 抓取失败时评分照常输出，含水量标记为「未知」，置信度下调。

## Out of Scope

- stargazer 账号年龄/画像分析（需要额外每用户请求）
- GHArchive 全量历史对账（P2/独立任务）

## Key Decisions

| 决策 | 结论 |
|------|------|
| 检测算法 | 突发窗口（时序异常）为主，比例检查为辅；不引入模型依赖 |
| 采样上限 | 前 400 个 stargazer（4 页）；仅 star ≥ 500 的仓库抓取 |
| 表述边界 | 只报告「疑似刷量窗口」，不做账号级指控 |
