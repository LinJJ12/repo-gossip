# Implement: 扩展侧边栏历史与关闭保活

## Checklist

1. [x] 在 `content.js` 增加历史读写：`repoGossipHistory` get/set、按 repo upsert、上限 20、MRU。
2. [x] 改 `panelEl`：`×` 改为 hide；抽出 `showPanel` / `hidePanel` / `ensurePanelVisible`。
3. [x] Header 增加「最近」；实现列表视图与点选复开。
4. [x] 成功出报渲染后 upsert 历史；失败不写。
5. [x] 浮动按钮：有缓存则复开，无则 `runGossip`；成功视图加「重新出报」。
6. [x] `content.css`：历史列表、「最近」/「重新出报」按钮样式（贴合现有面板）。
7. [x] `manifest.json` patch 版本号（如 0.2.8 → 0.2.9）。
8. [ ] 手动验证 AC1–AC5（GitHub 仓库页 + 本地 API）。
9. [x] 缺陷修复：出报竞态 / 历史写锁 / 瘦身入库 / warnings 非数组 / 损坏缓存提示；`history-logic.js` + 单测。

## Validation

- `node --check apps/extension/{history-logic,content}.js`
- `npm test`（含 `test/extension-panel-history.test.ts`）
- 手动：同仓关开无二次请求（DevTools Network / background 日志）。
- 手动：两仓出报 →「最近」可见 → 点选复开。
- 手动：重新出报后内容与列表更新。
- 手动：重启浏览器后历史仍在。
- 手动：故意失败出报 → 不进列表。

## Risky files / rollback

- `apps/extension/content.js` — 主逻辑；回退该文件即恢复旧关闭行为。
- `apps/extension/content.css` — 样式；可单独回退。
- Storage key `repoGossipHistory` — 可 `chrome.storage.local.remove` 清理。

## Before `task.py start`

- [x] `prd.md` 收敛完成
- [x] `design.md` / `implement.md` 就位
- [x] `implement.jsonl` / `check.jsonl` 已填真实 spec 条目
- [ ] 用户明确批准本规划摘要后再 `task.py start`
