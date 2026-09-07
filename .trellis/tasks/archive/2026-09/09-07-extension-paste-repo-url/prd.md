# 扩展支持粘贴仓库 URL 出报

## Goal

用户不必先打开目标仓库页，也能在扩展整页内粘贴 GitHub 仓库地址、生成并阅读接近 web 端的八卦小报。

## Background

- 现状：仅仓库页 content 按钮出报；工具栏打开设置 `options.html`。
- API / `parseRepoRef` 已支持 URL 与 `owner/repo`；web 已有 compose + `TabloidView`。
- 出报链路：`GOSSIP_FETCH` → `background.js` → `POST /api/gossip`。

## Decisions

| 决策 | 结论 |
|------|------|
| UI 宿主 | 扩展整页：设置 ↔ 出报 |
| 与 web 对齐 | **A**：布局/文案/主控件对齐 web，原生 HTML/JS，不打包 React |
| 工具栏图标 | **1**：默认打开出报页；未配置时引导去设置 |
| 窄 popup 出报 | 不作 MVP |
| 当前页预填 | 延后 |

## Requirements

1. 扩展整页出报界面：品牌 `repo/gossip`、粘贴输入、回溯天数、LLM 开关、出报按钮、错误/加载、小报结果区（结构化区块，对齐 web 小报主要章节；缺结构时回退 plain）。
2. 出报页有「设置」按钮进入设置界面。
3. 设置界面保存成功后进入出报界面；设置项仍写入 `chrome.storage.local`（API Base URL、BYOK、默认 days/offline 等）。
4. 出报页上的回溯 / LLM 与 storage 同步（改动可写回，生成时使用当前值）。
5. 点击工具栏图标打开（或聚焦）出报整页；无 API Base URL 时显著引导「去设置」。
6. 输入支持 `owner/repo` 与 GitHub URL；可传原文给 API。
7. 仓库页 content「八卦小报」保留，仍走 `GOSSIP_FETCH`。

## Acceptance Criteria

- [ ] 点击工具栏图标打开出报整页（非设置表单）。
- [ ] 出报页可粘贴 `owner/repo` 或 GitHub URL 并出报（配置正确时）。
- [ ] 出报页可通过按钮进入设置；设置保存后回到出报页。
- [ ] 出报页含接近 web 的主控件与小报结果展示（非仅一行 toast）。
- [ ] 未配置 API Base URL 时有引导去设置，不静默失败。
- [ ] 非仓库页可完成粘贴出报。
- [ ] 仓库页「八卦小报」按钮仍可用。

## Out of Scope

- 将 `apps/web` React 打进扩展。
- Side Panel、后台续跑/通知、当前标签预填。
- 非 GitHub、批量出报、历史记录。
- 重做 content script 侧栏为完整 TabloidView（保持现有 panel 即可）。

## Technical Notes

- 改动主要在 `apps/extension/`；core/API 不改。
- 取消以设置页作为 `default_popup`；改为 `action.onClicked` 打开整页（或等价整页入口）。
