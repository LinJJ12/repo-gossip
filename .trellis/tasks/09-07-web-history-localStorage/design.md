# Design: Web + 扩展工具栏本地历史

## Architecture / Boundaries

| Surface | Storage | UI |
|---------|---------|-----|
| GitHub sidebar | `chrome.storage.local` → `repoGossipHistory` | 已有 header「最近」（不改交互） |
| Toolbar popup + full page | **同一** `repoGossipHistory` | chips 旁「最近」展开列表 |
| Web preview | `localStorage` → `repoGossipHistory` | chips 旁「最近」展开列表 |

- **不改**：`/api/gossip` 契约、侧边栏关闭保活、Web↔扩展同步。
- **扩展写入/读取**：一律经 `RepoGossipHistoryLogic`（`history-logic.js`）。
- **Web**：新建 `apps/web/src/history.ts`，行为对齐 Logic（normalizeRepoKey、slim、upsert、limit 20）；`load/save` 包一层 `localStorage` + JSON.parse 容错。

## Data flow

### Web

```
generate success → buildHistoryEntry(repo, data) → upsert → localStorage.setItem
「最近」toggle → load list → render rows
click row → setData(entry.data), setRepo, isSample=false  (no fetch)
```

### Extension popup / full page

```
GOSSIP_FETCH success → buildHistoryEntry → upsert → chrome.storage.local
「最近」toggle → loadHistory → render list in #stage (or dedicated panel under chips)
click row → renderTabloid(entry.data)  (no sendMessage)
```

Sidebar continues its existing path; same storage key means lists converge.

## UI contract (Web + popup)

- Chip label：`最近`；展开时 `aria-expanded=true`；再点收起。
- 列表项：`repo`、`epicTitle`（缺省回退 repo）、短时间（locale 或相对均可，与侧边栏一致优先）。
- 空列表：一句「还没有缓存的小报」。
- 展开列表不改变 brand hero 结构；列表可落在 examples 下方或 stage 顶部。

## Loading history-logic in popup

Options (pick simplest that works with MV3):

1. `popup.html` / `app.html` 增加 `<script src="history-logic.js">` 再加载 `app.js`；或
2. `app.js` 开头依赖已注入的 `globalThis.RepoGossipHistoryLogic`。

Bump `manifest.json` `version` on user-visible change.

## Compatibility

- 缺 key / 坏 JSON → `[]`。
- Web 与扩展同名 key 但不同后端，**禁止**假设互通。
- Slim 字段须足够 `TabloidView` / `renderTabloid` 渲染（对齐现有 `slimGossipData`）。

## Risks

| Risk | Mitigation |
|------|------------|
| `localStorage` 配额 | slim payload；上限 20 |
| popup 未加载 history-logic | HTML script 顺序 + 启动 assert |
| 列表 XSS | 继续 escapeHtml；不存原始 HTML |

## Rollback

还原 Web history 模块与 App UI；扩展去掉 popup 写入/「最近」与 script 引用，回退 version。
