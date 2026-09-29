# 核心契约单测补强

## Goal

给「改错了不会立刻崩、但会静默劣化输出」的那批纯逻辑补上 fixture 单测。这些函数没有测试，却是 Web / 扩展 / Bot 三端内容的来源——回归只能靠肉眼看出报效果，代价太高。

## Background

`npm test` 现有 79 个用例，覆盖了 `parseRepoRef`、`analyzeSnapshot`、`buildOfflineTabloid`、`dramatizeLocally`、`normalizeTranslations`、历史缓存、限流、BYOK 等。但以下几处纯逻辑**没有任何直接测试**：

| 目标 | 位置 | 为什么危险 |
|------|------|-----------|
| `parseTabloidJson` | `packages/core/src/llm.ts:166` | LLM 输出解析；字段补位逻辑写错会静默产出空 drama / 空标题 |
| `toDiscordEmbed` | `packages/core/src/format.ts:68` | Discord / `format=discord` 的 embed；4000 字符截断与标题清洗无断言 |
| `toFeishuCard` | `packages/core/src/format.ts:88` | 飞书卡片；`test/feishu.test.ts` 只测事件解析，没测卡片构造 |
| Release 窗口过滤 | `packages/core/src/github.ts:184-197` | 窗口外 Release 回填会误颁「发版烟花」奖——这是 PRD 明确否决过的回归 |
| issue 去 PR 过滤 | `packages/core/src/github.ts:152` | GitHub issues API 会把 PR 当 issue 返回，漏过滤会让小报出现「Issue #N」实为 PR 的错误线索 |

其中后两条目前埋在 `fetchActivity` 的 async 闭包里，**不可单测**——需要先抽成纯函数才能测，这是本任务的一部分工作。

## Requirements

1. **抽取纯函数**（不改行为）：把 Release 窗口过滤与 issue 去 PR 的映射/过滤逻辑抽成 `github.ts` 内的可导出纯函数，例如 `mapReleasesInWindow(raw[], sinceMs)` 与 `filterNonPullIssues(raw[])`；`fetchActivity` 改为调用它们。
2. **新增 `test/core-contract.test.ts`**，覆盖：
   - `parseTabloidJson`：正常 JSON / 数组字段为字符串 / 字段缺失 / 中文键名 translations
   - `toDiscordEmbed`：标题里的 `《》` 被清洗、`description` 长度 ≤ 4000、温度对应颜色
   - `toFeishuCard`：`msg_type` 为 `interactive`、header template 随温度变化、lark_md 内容 ≤ 4000
   - `mapReleasesInWindow`：窗口内保留、窗口外剔除、空 tag 剔除、按发布时间降序、上限裁剪
   - `filterNonPullIssues`：带 `pull_request` 的条目被剔除、正常 issue 保留
3. **不依赖 LLM 与网络**：全部用 fixture，与 `quality-guidelines.md` 一致。
4. **断言中文与标点回归**：沿用 `core.test.ts` 既有风格（例如断言奖项行不匹配 `/\?\w/`）。
5. **不改外部行为**：抽取纯函数时行为必须与今日完全一致（含排序与裁剪顺序）。

## Acceptance Criteria

- [x] 上表 5 个目标均有直接单测，且每个目标至少 1 个「正常」+ 1 个「边界」用例。（解析目标由 child 1 的 `safeParseTabloid`/`normalizeRawJson` 覆盖，本任务再补 4 个场景用例。）
- [x] Release 窗口过滤有显式用例：窗口外的 Release 不进入结果（防「发版烟花」误颁回归）。
- [x] issue 过滤有显式用例：带 `pull_request` 字段的条目被剔除。
- [x] `npm test` 全绿，用例总数较改动前增加；`npm run typecheck` 全绿。
- [x] 抽取纯函数后，`fetchActivity` 的实际行为无变化（mapReleasesInWindow / filterNonPullIssues 逐字段比对原闭包逻辑）。

## 实现记录（2026-09-29）

- 代码改动：`packages/core/src/github.ts`（抽取 `filterNonPullIssues` + `mapReleasesInWindow`，`fetchActivity` 改为调用它们，顺序/裁剪/映射逐项核对保持一致）+ `test/core-contract.test.ts`（16 例）。
- 解析契约：`parseTabloidJson` 在 child 1 已重构为 `safeParseTabloid`/`normalizeRawJson`，本任务新增 4 个解析场景用例（完整 / 数组字段为字符串 / 缺失 closing / 中文键名 translations）覆盖该目标。
- `toDiscordEmbed`：标题剥《》、温度→颜色（frozen=蓝 / warm=黄 / blazing=红）、description ≤ 4000 截断、离线文案不含 `?\w` 残损标点。
- `toFeishuCard`：`msg_type=interactive`、header template 随温度（blue/orange/red）、lark_md ≤ 4000 截断。
- `mapReleasesInWindow`：窗口内保留、窗口外与空 tag 剔除、降序、按 `max` 裁剪；含「休眠仓库古老 Release 不误触发发版奖」回归用例。
- `filterNonPullIssues`：带 `pull_request` 的条目剔除，正常 issue 保留。
- 全量 `npm test`：121 pass / 0 fail / 0 cancelled。`npm run typecheck -w @repo-gossip/core` 通过。
- 未抽 `test/fixtures.ts`（Open Question）：两个测试文件各保留本地 `emptySnapshot` 等 helper，改动面更小，符合「评估改动面」的结论。

## Out of Scope

- 覆盖率门禁、CI 里的覆盖率上传
- 端到端 / 集成测试（真实调用 GitHub 或 LLM）
- 扩展端 `app.js` / `content.js` 的测试（它们是未模块化的原生 JS，需先拆分）
- 性能基准

## Key Decisions

| 决策 | 结论 |
|------|------|
| 是否为了可测而重构生产代码 | **是**，但仅限把闭包内的纯逻辑抽成同文件内的导出函数，不改行为 |
| 测试文件组织 | 集中一个 `test/core-contract.test.ts`，与既有按主题分文件（`byok` / `rate-limit-cache` / `web-history`）的惯例一致 |
| 是否引入 zod 做输出契约校验 | 否，保持 `String()` / `Array.isArray` 手写守卫的既有风格 |
| 与 `llm-resilience-output-validation` 的时序 | 建议在它之后做，避免对 `parseTabloidJson` 的断言二次返工 |

## Open Questions

1. 是否要把 `test/core.test.ts` 里的 `emptySnapshot` / `activitySnapshot` fixture 抽成共享 helper？倾向抽出放到 `test/fixtures.ts`，避免新测试文件重复造轮子——但会改动既有测试文件，实现时评估改动面。
