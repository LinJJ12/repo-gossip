# Chrome 扩展（开源 sideload）

在 GitHub 仓库页注入「八卦小报」按钮；Options 配置 API 与 BYOK。

## 加载方式

1. 本机或自建实例先能访问 `/api/gossip`（本地：`npm run web` → `http://localhost:5173`）。
2. Chrome 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择本目录 `apps/extension`。
3. 点扩展图标或「扩展选项」，填写 **API Base URL**（默认 `http://localhost:5173`），按需填 GitHub / LLM 令牌。
4. 打开任意 `https://github.com/owner/repo`，点「八卦小报」。

可选：在扩展管理页「打包扩展程序」生成 `.crx` 分发给试用用户（仍非 Chrome Web Store）。

## 安全说明

- 不要在扩展里硬编码服务端 `WEBHOOK_SECRET`。
- BYOK 密钥只存在用户本机 storage，请求时以 `x-*` 头发给你配置的 API。
