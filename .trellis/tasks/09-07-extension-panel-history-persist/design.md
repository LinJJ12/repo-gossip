# Design: 扩展侧边栏历史与关闭保活

## Architecture / Boundaries

- **改动层**：仅 GitHub content script（`content.js` + `content.css`）。
- **不改**：`background.js` 的 `GOSSIP_FETCH` 契约、`/api/gossip`、Web `TabloidView`。
- **持久化**：`chrome.storage.local`（与按钮位置、设置共用同一命名空间，使用独立 key）。

## Panel State Machine

| 状态 | 含义 |
|------|------|
| absent | 无面板 DOM（首次进入页） |
| visible | 面板显示（加载中 / 成功 / 失败 / 历史列表） |
| hidden | 面板 DOM 仍在，`display:none` 或等价 class；body 内容保留 |

- `×`：`visible` → `hidden`（禁止 `remove()`）。
- 显示触发（浮动按钮复开、最近点选、重新出报开始）：若 `hidden`/`absent` → `visible`。
- 标签页内 SPA 换仓：不强制清面板；点当前仓「八卦小报」按缓存/拉取规则更新 body。

## Floating Button Click

```
if history.has(currentRepo):
  show cached report (no GOSSIP_FETCH)
else:
  GOSSIP_FETCH → on success upsert history
```

「重新出报」始终 `GOSSIP_FETCH`，成功后 upsert。

## Storage Contract

Key: `repoGossipHistory`（数组，MRU 在前）。

每条最小字段：

```ts
{
  repo: string;          // owner/repo
  savedAt: number;       // Date.now()
  mode?: string;
  epicTitle?: string;
  plain: string;         // message.plain（复开正文）
  data: object;          // 成功响应中供 linkify/meta 用的子集或完整 data
}
```

约束：

- 写入前：同 `repo` 已有条目先删除，再 unshift 新条。
- 截断：`length > 20` 则 `slice(0, 20)`。
- 仅 `response.ok` 且可渲染时写入；错误态不写。
- 体积：优先存完整 `data`（与现 render 一致）；若实测过大再裁到 `{ mode, message, tabloid, warnings, llmError }`。MVP 先完整 `data` + `plain`/`epicTitle` 冗余便于列表展示。

## UI Surface

Header：`repo/gossip` | **最近** | **×**

- **最近**：切换 body 为列表（repo、epicTitle 或 repo 回退、相对/短时间）；点行 → 渲染该条小报视图。
- 成功小报视图底部或标题旁：**重新出报**。
- 列表为空时一句静默提示即可。

样式延续现有暗色面板 token（`content.css`），不引入新设计体系。

## Compatibility

- 旧用户无 `repoGossipHistory` → 视为 `[]`。
- 不迁移其他 key；不读写设置字段。
- `permissions` 已含 `storage`，manifest 权限无需新增；建议 bump `version` 以区分 sideload。

## Trade-offs

| 选择 | 理由 |
|------|------|
| 存 API `data` 而非仅 HTML | 复用 `linkifyPlainHtml`，避免存 XSS 风险更高的 HTML 快照 |
| 隐藏而非销毁 | 满足「误关可回」且实现成本低于独立最小化态 |
| 无 TTL | 产品未要求；条数上限控制配额 |

## Rollback

- 回退 content 改动即可；删除 `repoGossipHistory` key 可清空历史，不影响出报主路径。
