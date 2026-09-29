# Web + 扩展工具栏本地历史记录

## Goal

Web 预览站与 Chrome 扩展工具栏（弹层 + 完整页面）出报成功后，可通过「最近」立刻回看本机缓存小报（不打 API）。扩展侧边栏、弹层、完整页面共用同一份 `repoGossipHistory`；Web 使用独立的 `localStorage`（本任务不做 Web↔扩展同步）。

## Background

- 侧边栏已具备「最近」与 `chrome.storage.local` 持久化（`history-logic.js` + `content.js`）。
- 弹层 / 完整页（`popup.html` / `app.html` + `app.js`）可出报，但不写历史、无「最近」UI。
- Web（`apps/web`）仅内存态当前报告；刷新即失。
- 网页与扩展存储隔离；本任务明确不做桥接。

## Decisions

| 决策 | 结论 |
|------|------|
| 点历史条目 | 立刻复开缓存，不请求 API；要新内容再点「出报」 |
| Web / 弹层入口 | chips 旁「最近」chip，点击展开/收起列表 |
| 侧边栏 ↔ 弹层 ↔ 完整页 | 共用 `repoGossipHistory` |
| Web ↔ 扩展 | **不同步**；Web 用 `localStorage` 独立一份 |
| 清空 / 导出 / TTL / 云同步 | MVP 不做 |

## Requirements

1. **Web 写入**：真实出报成功后 upsert 到 `localStorage`；样报与失败不写；上限 20；同仓（规范化 `owner/repo`）覆盖为最新。
2. **Web「最近」**：examples 行增加「最近」chip；展开列出 repo、标题摘要、时间；点选立刻用缓存填充主区域（无 `/api/gossip`）；列表为空时有简短提示。
3. **扩展弹层/完整页写入**：出报成功后经同一套 history 逻辑 upsert 到 `repoGossipHistory`。
4. **扩展弹层/完整页「最近」**：examples 行「最近」chip + 展开列表；点选立刻复开缓存（无 `GOSSIP_FETCH`）。
5. **扩展三处一致**：侧边栏已写出的条目在弹层「最近」可见，反之亦然。
6. **逻辑复用**：扩展侧优先复用 `RepoGossipHistoryLogic`（`history-logic.js`）；Web 用等价 TypeScript 模块（规则对齐：normalize / slim / upsert / limit 20）。

## Acceptance Criteria

- [x] AC1（Web）：两仓成功出报后「最近」可见两者；点选立刻复开且无新 `/api/gossip`；样报与失败不入库；刷新后仍可打开（≤20）。
- [x] AC2（弹层/完整页）：两仓成功出报后「最近」可见；点选立刻复开且无新 `GOSSIP_FETCH`；失败不入库；重启浏览器后仍可打开（≤20）。
- [x] AC3（共用）：侧边栏写入的条目出现在弹层「最近」；弹层写入的条目出现在侧边栏「最近」。
- [x] AC4：Web 历史与扩展历史互不影响（各写各的存储）。

## E2E 验证记录（2026-09-29）

**已执行并通过**

| 项 | 方式 | 结果 |
|----|------|------|
| 真实出报链路 | 起 Vite dev server，POST `/api/gossip`（真实 GitHub，`sindresorhus/is` / `facebook/react`，offline） | `mode=offline`，正常出报 |
| 成功出报写入历史 | 真实响应喂给真实 `apps/web/src/history.ts` | 写入 1 条 → 第二条后 2 条 |
| 同仓覆盖为最新 | 同上，重复出报同一仓库 | 仍 2 条，同仓仅 1 条 |
| 刷新后仍可打开 | 用同一份 localStorage 原始数据重建 storage 再 load | 2 条可读，`analyzed` 完整 |
| 上限 20 | 写入 25 个不同仓库 | 截断为 20 |
| 失败/样报不入库 | 错误响应 + 不可定位仓库的 payload | 均不写入 |
| 单元级 | `npm test`（`test/web-history.test.ts` 10 个用例 + `test/extension-panel-history.test.ts`） | 79 passed / 0 failed |

**未在本机执行的项**

- 「点选最近条目**不发起新请求**」这一条是靠代码结构保证的（`App.tsx` 的 `openHistoryEntry` 只做 `slimGossipData` + `setData`，不调用 `fetch`），但**没有在真实浏览器里点过**。
- 扩展侧 AC2 / AC3（弹层、完整页、侧边栏三处共用 `chrome.storage.local`）**没有在加载了已解压扩展的 Chrome 里验证**；只有 `history-logic.js` 的单测覆盖。

原因：本机 `127.0.0.1` 被 HTTP 代理劫持（返回 502），`agent-browser` 导航持续挂起；机器上存在用户自己的 Chrome 会话，不能为了腾出环境去杀进程。

**结论**：数据与逻辑层端到端通过；**扩展三处 UI 的 AC2/AC3 建议在做一次人工浏览器验收**（`chrome://extensions` → 加载 `apps/extension` → 侧边栏与弹层各出报一次 → 互相可见）。若发现偏差，另立缺陷任务处理。

## Out of Scope

- Web ↔ 扩展桥接 / `externally_connectable` / 云端历史
- CLI 历史、清空/导出 UI、缓存 TTL
- 改侧边栏现有关闭保活 / 同仓复开行为（除非为共用写入对齐所必需的最小改动）

## Technical Notes

- Web：`apps/web/src/` 新增 history 模块；`App.tsx` + `styles.css`；键名建议 `repoGossipHistory`（与扩展语义对齐，但存储后端不同）。
- 扩展：`app.js` / `popup.html` / `app.html` / `app.css`；`manifest.json` 让 popup/app 也能加载 `history-logic.js`（或等价内联引用）；bump extension version。
- 测试：扩展逻辑已有 `test/extension-panel-history.test.ts`；Web 新增对 upsert/normalize 的单测（或复用可抽取的纯函数测试）。
