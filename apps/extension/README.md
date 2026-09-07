# repo-gossip Chrome 扩展

开源 **Manifest V3** 扩展：在浏览器里粘贴 GitHub 仓库地址，生成「项目八卦小报」。

> **不在 Chrome 应用商店上架。** 请用开发者模式「加载已解压的扩展程序」（sideload），或自行打包 `.crx` 分发。

---

## 功能

| 能力 | 说明 |
|------|------|
| 工具栏弹层 | 点击扩展图标 → 约 360px 弹层，粘贴 `owner/repo` 或 GitHub URL 出报 |
| 设置页 | 弹层内「设置」：API Base URL、GitHub Token、LLM BYOK、回溯天数等 |
| 完整页面 | 「完整页面」打开大屏界面，阅读体验接近 Web 站 |
| GitHub 页按钮 | 在仓库页显示可 **拖动** 的「八卦小报」按钮，点击出报 |
| BYOK | 密钥只存在本机 `chrome.storage.local`，请求时以 `x-*` 头发给 API |

扩展 **不内置** 八卦引擎，只调用你配置的后端 `POST /api/gossip`。

---

## 前置条件

先准备一个可访问的 API，例如：

**本机开发**

```bash
# 在仓库根目录
npm install
npm run web
# → http://localhost:5173  提供页面与 /api/gossip
```

**已部署实例**

- 例如 Vercel 上的 `https://your-app.vercel.app`
- 需能成功：`POST /api/gossip`（可用 curl 或 Web 站验证）

---

## 在 Chrome 中安装

1. 打开 Chrome，地址栏进入：

   ```
   chrome://extensions
   ```

2. 右上角打开 **「开发者模式」**。
3. 点击 **「加载已解压的扩展程序」**。
4. 选择本仓库中的目录：

   ```
   …/repo-gossip/apps/extension
   ```

   （选中含 `manifest.json` 的那一层，不要选整个 monorepo 根目录。）

5. 安装成功后，工具栏应出现 **repo-gossip** 图标。若没有，点拼图图标固定到工具栏。

### 更新扩展

改完 `apps/extension` 里的代码后，回到 `chrome://extensions`，点该扩展卡片上的 **刷新** 按钮。

### Edge / Chromium

同样支持：打开扩展管理页 → 开发者模式 → 加载已解压扩展 → 指向 `apps/extension`。

---

## 怎么用

### A. 任意网页：工具栏出报

1. 点击工具栏 **repo-gossip** 图标。
2. 若尚未配置，点 **「设置」**：
   - **API Base URL**（必填）：如 `http://localhost:5173` 或你的线上域名（不要末尾多余路径）。
   - 可选：GitHub Token、LLM API Key / Base URL / Model。
   - 出报默认：回溯天数、「仅本地模板」（不调 LLM）。
3. 点 **「保存设置」** → 自动回到出报页。
4. 输入例如：

   ```
   sindresorhus/is
   https://github.com/facebook/react
   ```

5. 点 **「出报」**。生成过程中请 **保持弹层打开**（关掉会中断请求）。
6. 需要大屏阅读时，点 **「完整页面」**。

### B. GitHub 仓库页：浮动按钮

1. 打开任意仓库主页，如 `https://github.com/owner/repo`。
2. 页面上出现可拖动的 **「八卦小报」** 按钮（位置会记住）。
3. **拖动** 调整位置；**单击** 生成小报（侧栏展示）。

### C. 浏览器「扩展选项」

在 `chrome://extensions` → repo-gossip → **「扩展程序选项」**，会打开设置界面（与弹层内设置同一套存储）。

---

## 配置项说明

| 配置 | 必填 | 说明 |
|------|------|------|
| API Base URL | 是 | 后端根地址，扩展请求 `{base}/api/gossip` |
| GitHub Token | 否 | 提高 GitHub API 限额 / 私有仓 |
| LLM API Key 等 | 否 | BYOK；不填则用服务端 `.env`（若有） |
| 回溯天数 | 否 | 默认 14，范围与后端一致（1–90） |
| 仅本地模板 | 否 | 勾选后不调用 LLM |

---

## 打包分发（可选）

仍非应用商店上架，仅适合可信小范围分发：

1. `chrome://extensions` → **「打包扩展程序」**。
2. 根目录选 `apps/extension`，可生成 `.crx`（以及私钥 `.pem`）。
3. **切勿**把 `.pem` 提交进 Git 或公开分享。

---

## 故障排除

| 现象 | 排查 |
|------|------|
| 出报报错 / 连不上 | 确认 API Base URL 可在浏览器打开；本机需先 `npm run web` |
| CORS / 网络失败 | 扩展经 background 发请求；检查后端是否在跑、URL 是否 `http/https` |
| GitHub 页没有按钮 | 确认扩展已启用，且页面是仓库路径 `github.com/owner/repo`；刷新扩展后再刷新页面 |
| LLM 相关失败 | 在设置里填 BYOK，或在服务端 `.env` 配置 LLM；也可勾选「仅本地模板」 |
| 弹层关掉后没结果 | 当前设计：弹层关闭即中断；可改用「完整页面」再出报 |

---

## 安全与隐私

- 不要在扩展源码里硬编码 `WEBHOOK_SECRET`、云厂商密钥。
- BYOK 仅存本机；请求发往你填写的 API Base URL。
- 本扩展未上架商店，更新需自行重新加载或分发新包。

---

## 相关链接

- 项目总览与 API：[../../README.md](../../README.md)
- 架构说明：[../../docs/architecture.md](../../docs/architecture.md)
- 许可证：[MIT](../../LICENSE)
