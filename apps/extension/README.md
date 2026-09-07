# Chrome 扩展（开源 sideload）

点击扩展图标打开整页出报界面（对齐 web：粘贴仓库地址 → 出报）；GitHub 仓库页仍有「八卦小报」按钮。设置在出报页右上角进入。

## 加载方式

1. 本机或自建实例先能访问 `/api/gossip`（本地：`npm run web` → `http://localhost:5173`）。
2. Chrome 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择本目录 `apps/extension`。
3. 点扩展图标打开 **360px 工具栏弹层**（出报 / 设置互跳）；需要大屏阅读时点「完整页面」。
4. 在弹层粘贴 `owner/repo` 或 GitHub URL 点「出报」；或打开 `https://github.com/owner/repo` 用页内「八卦小报」按钮。

可选：在扩展管理页「打包扩展程序」生成 `.crx` 分发给试用用户（仍非 Chrome Web Store）。

## 安全说明

- 不要在扩展里硬编码服务端 `WEBHOOK_SECRET`。
- BYOK 密钥只存在用户本机 storage，请求时以 `x-*` 头发给你配置的 API。
