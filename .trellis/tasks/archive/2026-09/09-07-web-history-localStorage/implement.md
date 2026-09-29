# Implement: Web + 扩展工具栏本地历史

## Checklist

1. **Web pure history module** — `apps/web/src/history.ts`（normalize / slim / upsert / localStorage IO）；单测覆盖核心规则。
2. **Web UI** — `App.tsx`：成功写入、「最近」chip + 列表、点选复开；`styles.css` 列表样式（对齐现有 chip / 暗色 token）。
3. **Extension popup wiring** — `popup.html` / `app.html` 引入 `history-logic.js`；`app.js` 成功 upsert +「最近」UI；`app.css` 样式。
4. **Manifest** — bump version；确认 script 加载顺序。
5. **Verify AC3** — 侧边栏出报后弹层「最近」可见（手动或存储层断言）。
6. **Typecheck / tests** — `npm test`、`npm run typecheck -w @repo-gossip/web`。

## Validation

```bash
npm test
npm run typecheck -w @repo-gossip/web
```

Manual：

- Web：两仓出报 → 「最近」→ 点选无网络 → 刷新仍在；样报不入库。
- 扩展：弹层两仓出报 → 「最近」复开；侧边栏出报后弹层可见同一条。

## Risky files

- `apps/extension/app.js`（弹层主逻辑，易回归出报流）
- `apps/web/src/App.tsx`（hero 布局）

## Explicitly not doing

- Web↔扩展同步、清空 UI、改 sidebar 保活状态机
