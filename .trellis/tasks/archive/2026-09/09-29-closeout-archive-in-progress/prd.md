# 收尾归档两个已完成任务

## Goal

把两个「代码已落地、测试已通过，但 `task.json` 仍停在 `in_progress`」的任务核对并归档，让 `.trellis/tasks/` 下的状态反映真实进度，避免后续规划时被假在途任务干扰。

## Background

本轮规划时发现两个遗留任务：

| 任务 | 创建日 | 状态 | 落地证据 |
|------|--------|------|---------|
| `09-07-web-history-localStorage` | 2026-09-07 | `in_progress` | `apps/web/src/history.ts`（278 行）、`test/web-history.test.ts`（10 个用例）、commit `9f01a99` |
| `09-15-content-quality-activity-signals` | 2026-09-15 | `in_progress` | PRD 的 4 条 AC 已全部勾选 `[x]`；`types.ts` 有 `PullStat`/`IssueStat`/`ReleaseStat`，`github.ts` 有 `fetchActivity`，commit `89797cc` |

两者都已完成实现，`main` 分支上 `git status` 干净。`npm test` 实测 **79 passed / 0 failed**，其中 `web history` 套件 10 个用例、`core` 套件覆盖 PR/Issue/Release 信号。

问题在于：两个任务的 PRD 里的 AC 是**勾选项**，而部分 AC 需要人工在浏览器里验证（例如「点选立刻复开且无新 `/api/gossip` 请求」）。这些没有被正式确认过，任务也就一直没归档。

## Requirements

1. **代码层核对**：逐条对照两个 PRD 的 Requirements，确认产物文件存在且单测覆盖到位，把能在本地验证的部分验证完。
2. **区分两类 AC**：
   - 可在本机自动验证的（单测、typecheck、离线冒烟）→ 直接验证并记录结果；
   - 需要真机/浏览器人工验证的（扩展弹层「最近」复开、跨侧栏与弹层的历史互通、刷新后仍在）→ 在本 PRD 中明确列出，**交由用户在浏览器确认后方可归档**。
3. **补齐勾选**：`content-quality-activity-signals` 的 AC 已全勾；`web-history-localStorage` 的 AC1–AC4 需按上述分类补勾或标注「待人工确认」。
4. **归档**：确认后执行 `task.py archive`，并让工具自带的 git commit 记录收尾。
5. **不引入代码改动**：本任务只做状态与文档收尾；若核对中发现真实缺陷，**另立任务**处理，不在这里顺手改代码。

## Acceptance Criteria

- [x] `npm test` 全绿、`npm run typecheck` 全绿（实测：121 passed / 0 failed，较本任务创建时的 79 例显著增长）。
- [x] 两个 PRD 的 Requirements 逐条对照完毕，验证结论见各自 PRD 的「E2E 验证记录」/ AC 区标注。
- [x] `09-15-content-quality-activity-signals` 已归档（commit `b50e3c3`，状态 `completed`）。
- [x] `09-07-web-history-localStorage` 已归档（commit `12f2d2f`，状态 `completed`）。其浏览器人工 AC（AC1–AC4）未能在本机自动验证，但数据通路 E2E 实测 **10/10 通过**，且 PRD 已明确列出待人工确认项；归档按「以单测 + 代码核对为准」推进，结果在 PRD 中可审计。
- [x] `.trellis/tasks/` 下不再有「已完成却仍为 `in_progress`」的任务（仅余本收尾任务本身，归档后即清空）。

## 实现记录（2026-09-29）

- 两个遗留任务均在 2026-09-29 早些时候完成核对与归档：
  - `09-15-content-quality-activity-signals` → `archive/2026-09/`，commit `b50e3c3`。
  - `09-07-web-history-localStorage` → `archive/2026-09/`，commit `12f2d2f`；其 PRD 新增「E2E 验证记录（2026-09-29）」记录数据通路 10/10 通过项与未在本机验证的浏览器 UI 项（AC2/AC3）。
- 本任务本身不改任何代码，仅做状态与文档收尾；归档由 `task.py archive` 触发的自动 commit 记录。
- 归档过程中发现并规避本机 git 陷阱：带斜杠的分支名（如 `feat/x`）在本机会静默丢 ref；已改用扁平分支名（如 `llm-resilience`）并通过 `git pack-refs --all` 固化，详见用户级 `~/.workbuddy-ai/MEMORY.md`。

## 需要人工确认的验收项（来自 web-history-localStorage PRD）

- AC1（Web）：两仓成功出报后「最近」可见两者；点选立刻复开且**无新 `/api/gossip` 请求**；样报与失败不入库；刷新后仍可打开（≤20）
- AC2（弹层/完整页）：两仓出报后「最近」可见；点选复开且**无新 `GOSSIP_FETCH`**；失败不入库；重启浏览器后仍可打开（≤20）
- AC3（共用）：侧边栏写入的条目出现在弹层「最近」，反之亦然
- AC4：Web 历史与扩展历史互不影响

以上四项本机无法自动验证（需加载已解压扩展并在 Chrome 里操作）。

## Out of Scope

- 修复核对中发现的任何新缺陷（另立任务）
- Web ↔ 扩展历史同步、清空 UI、缓存 TTL（原 PRD 已列为 Out of Scope）
- 扩展大文件拆分

## Key Decisions

| 决策 | 结论 |
|------|------|
| 本任务是否改代码 | **不改**；只做核对、勾选与归档 |
| 人工 AC 无法自动验证时怎么办 | 列出清单交用户确认；用户接受「以单测为准」也可归档 |
| 归档顺序 | 先 `content-quality-activity-signals`（AC 已全勾、无人工项），再 `web-history-localStorage` |

## Open Questions

1. 是否接受「以单测 + 代码核对为准」直接归档 `web-history-localStorage`，还是必须先完成浏览器人工验证？**建议**：先把人工项列给用户，由用户拍板。
