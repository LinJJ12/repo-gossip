# 提升小报内容质量：纳入 PR/Issue/Release 信号

## Goal

让「项目八卦小报」故事素材不再几乎只靠 commit：在 `runGossip` 管线内抓取并分析近期 Pull Request、Issue、Release，使 LLM 与 offline 模板写出信息更密、戏剧性更强的小报；**版式保持现有栏目，新信号织入事实与文案**（方案 A）。

## Background

- 今日 `fetchRepoSnapshot` 拉仓库元数据 + 近期 commit，并在 `sinceDays` 窗口内软失败抓取 PR / Issue / Release。
- 固定栏目不变：`epicTitle` / `awardsNarrative` / `temperatureLine` / `translations` / `easterEggLines` / `closing`。
- 改动落在 `packages/core`；适配层继续只调 `runGossip`。

## Requirements

1. 在 `sinceDays` 窗口内抓取有限数量的 PR、Issue（排除本身是 PR 的 issue）、Release；单路失败降级 + warning，不整单失败。窗外旧 Release **不**回填（避免误颁「发版烟花」）。
2. `analyzeSnapshot`（纯函数）产出 notable pulls / hot issues / latest release；`merge-machine` 需同一作者 ≥2 次合并；有窗口内 Release 时可颁 `ship-it`。
3. `buildFactSheet` 与 offline/fallback 模板纳入上述信号；三种 mode 内容质量都提升。
4. **不新增**独立 Markdown 栏目；页眉可补充活动计数。
5. 保持 mode 语义与 LLM JSON 英文字段契约；中文可读文案；`runGossip` 调用方无新必填参数。
6. Fixture 单测覆盖分析与 offline 出报中对非 commit 信号的可读体现。

## Acceptance Criteria

- [x] 窗口内若有 PR/Issue/Release 活动，llm 或 offline 小报能体现至少一类非 commit 信号（标题/编号/tag 等可读线索）
- [x] 无此类活动或接口失败时，行为不劣于今日：仍可出报，并有降级路径
- [x] offline 不依赖 LLM；相关单测通过
- [x] CLI / Web / 扩展 / API 无需改为完成本能力

## Out of Scope

- 飞书 / Telegram / Discord 新能力、Chrome 商店上架
- Web 分享页、关注列表云推送、账号体系、Gitee
- 新增独立「合并/议题/发版」Markdown 栏目（已否决，选 A）
- 严肃 brief 双语气、默认 `sinceDays` 变更

## Key Decisions

| 决策 | 结论 |
|------|------|
| 版式 | **A**：现有栏目织入，不新增独立栏目 |
| 范围 | PR + Issue + Release 一并纳入本任务 MVP |
| 渠道 | 不做 IM / 商店 |
| Release 窗口 | 仅窗口内；无则空，不回填历史发版 |
| merge-machine | ≥2 次合并 |

## Open Questions

（无）
