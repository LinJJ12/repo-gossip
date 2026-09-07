# Design: 扩展整页设置 ↔ 出报

## Architecture

```
工具栏图标
  → background action.onClicked
  → 打开/聚焦 chrome-extension://…/app.html（默认出报视图）

app.html
  ├─ view=compose  对齐 web：品牌 / 输入 / days / LLM / 出报 / 小报
  │     └─ [设置] → view=settings
  └─ view=settings 现有 options 表单（API / BYOK / 默认出报选项）
        └─ 保存成功 → view=compose

compose / content 均 → GOSSIP_FETCH → background.fetchGossip → POST /api/gossip
```

## File boundaries

| 文件 | 职责 |
|------|------|
| `app.html` + `app.js` (+ 内联或 `app.css`) | 双视图壳、出报 UI、小报渲染、设置表单（可迁入现 options 字段） |
| `options.html` | 可改为重定向到 `app.html#settings`，或删除并由 `options_ui` 直指 `app.html#settings` |
| `background.js` | 增加 `action.onClicked` 开页；保留 `GOSSIP_FETCH` |
| `manifest.json` | 去掉 `default_popup`；`options_ui` → 设置深链；版本 bump |
| `content.js` | 协议不变 |

## View model

- 用 `location.hash`：`#compose`（默认）/ `#settings`，便于选项页与书签。
- 未配置 `apiBaseUrl`：compose 顶栏提示 + 主按钮可改为「去设置」或出报时拦截并提示。

## Compose ↔ storage

- 加载时读 `days` / `offline`（offline ↔ UI「调用 LLM」取反，对齐 web）。
- 用户改天数/LLM：写回 `chrome.storage.local`（与设置页同一 key）。
- 生成：`sendMessage({ type: "GOSSIP_FETCH", repo })`；`days`/`offline` 仍由 background 从 storage 读取（改控件后先 await set 再 fetch，避免竞态）。

## Tabloid rendering

- 优先按 web `TabloidView` 章节渲染 API JSON：`epicTitle`、体温、颁奖、翻译、彩蛋、活跃成员、收束等（有字段才显示）。
- 无 `tabloid` 结构时回退 `message.plain`。
- 视觉：复用 options/web 的 CSS 变量（bg/ink/coral/lime、Syne/Manrope），单列居中，氛围用轻量 gradient/grain，避免 dashboard 卡片堆。

## Action click behavior

- `chrome.action.onClicked`：查询是否已有扩展 `app.html` 标签 → `update` 聚焦，否则 `tabs.create`。
- 无 `default_popup` 时才有 `onClicked`。

## Compatibility / migration

- 原「点图标 = 设置」改为「点图标 = 出报」；设置改由页内按钮或浏览器「扩展选项」。
- storage key 不变。

## Trade-offs

| 选择 | 取舍 |
|------|------|
| 单页双视图 | 跳转顺滑；`options.html` 需合并或重定向 |
| 原生镜像 web | 无 React 构建链；小报 DOM 需手写维护 |
| 结构化小报 | 更接近 web；比只显示 plain 工作量略高 |

## Rollback

- 恢复 `default_popup: options.html`，移除 `onClicked` 与 `app.html` 入口即可回到旧行为。
