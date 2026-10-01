# 仓库对比与双语评分卡

## Goal

支持 2-3 个仓库并排对比（分项表 + 雷达图），并让评分卡文案支持中英双语（README 徽章与分享卡出海的前提）。

## Requirements

1. **对比**：CLI `--compare a/b c/d` 与 Web 输入框（逗号分隔多仓库）→ 并排分项表（每维一列），共享同一坐标系；API `mode:"compare"`。
2. **雷达图**：Web 用内联 SVG 画五维雷达（零依赖）；Bot/CLI 输出文本分项表。
3. **i18n**：`formatScoreCard` 抽出文案字典（zh 默认，en 可选），`Accept-Language` / 查询参数 / CLI 标志选择；徽章文案同步双语。
4. **API 成本**：对比 = N×评分抓取，逐仓库独立软失败，单个失败不拖垮整表。

## Acceptance Criteria

- [x] 对比纯函数单测（多仓库聚合、缺失维度处理）；SVG 雷达快照断言。
- [x] en 文案单测覆盖所有输出键；zh 行为与现有快照一致（回归）。
- [x] `npm test`、typecheck 全绿；CLI/Web 冒烟。

## Out of Scope

- LLM 生成的对比结论（后续任务）
- 历史 trend 对比（依赖快照持久化，另立任务）

## Key Decisions

| 决策 | 结论 |
|------|------|
| 雷达实现 | 内联 SVG 零依赖，不引图表库 |
| i18n 机制 | 文案字典 + locale 参数，不引 i18n 框架 |
