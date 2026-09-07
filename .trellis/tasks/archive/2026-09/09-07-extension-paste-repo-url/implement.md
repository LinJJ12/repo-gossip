# Implement: 扩展整页设置 ↔ 出报

## Checklist

1. [x] 新增 `app.html` / `app.js`（必要样式）：`#compose` / `#settings` 双视图；hash 路由。
2. [x] 设置表单迁入 settings 视图；`options.html` 薄重定向。
3. [x] compose：输入、days、LLM、出报、加载/错误；先写 storage 再 `GOSSIP_FETCH`。
4. [x] 小报结构化渲染 + plain 回退。
5. [x] `background.js`：`action.onClicked` 打开/聚焦 `app.html`；保留 fetch。
6. [x] `manifest.json`：删除 `default_popup`；`options_ui` / version `0.2.0`。
7. [ ] 用户侧冒烟：工具栏 → 出报页；设置保存 → 回出报；粘贴 URL 出报；仓库页按钮。

## Validation

- 本地 `npm run web` + 加载未打包扩展。
- 非 GitHub 页：工具栏 → 粘贴 `sindresorhus/is` 或完整 URL → 出报。
- 出报页 → 设置 → 改 API/days → 保存 → 应回到出报且再生效。
- GitHub 仓库页：「八卦小报」侧栏仍出报。
- 清空 `apiBaseUrl`：出报有引导，不白屏。

## Risk / Rollback

- 风险：小报 DOM 与 web 长期漂移 → 只镜像稳定字段，不追求像素级一致。
- 回滚：恢复 `options.html` 为 `default_popup`。

## Before `task.py start`

- [x] prd / design / implement 齐备
- [ ] 用户批准本规划摘要
- [x] implement.jsonl / check.jsonl 有真实 spec 条目（若摘要有变可微更）
