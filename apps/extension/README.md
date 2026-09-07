# repo-gossip · Chrome 扩展

开源 **Manifest V3** 扩展：粘贴 GitHub 仓库地址，生成「项目八卦小报」。

> **不上架 Chrome 应用商店。**  
> 用开发者模式「加载已解压的扩展程序」（sideload），或自行打包 `.crx` 分发。

扩展 **不内置** 八卦引擎，只调用你配置的后端：`POST {API Base URL}/api/gossip`。

---

## 能做什么

| | |
|---|---|
| **工具栏弹层** | 点扩展图标 → 约 360px 弹层，粘贴 `owner/repo` / URL 出报 |
| **完整页面** | 「完整页面」打开大屏，阅读体验接近 Web 站 |
| **GitHub 侧边栏** | 仓库页可拖动的「八卦小报」按钮；关掉面板可复开缓存 |
| **最近历史** | 弹层 / 完整页 / 侧边栏 **共用** 本机历史（最多 20 条；点选立刻复开，不打 API） |
| **BYOK** | Token / LLM Key 只存 `chrome.storage.local`，请求时以 `x-*` 头发给 API |

> Web 预览站也有「最近」，但是用页面自己的 `localStorage`，**不会**和扩展历史同步。

---

## 安装前准备

先有一个可访问的 `/api/gossip`：

```bash
# 仓库根目录
npm install
npm run web
# → http://localhost:5173
```

或指向已部署实例（如 Vercel）：`https://your-app.vercel.app`。

---

## 安装到 Chrome

1. 打开 `chrome://extensions`
2. 打开右上角 **开发者模式**
3. **加载已解压的扩展程序** → 选本仓库的：

   ```text
   …/repo-gossip/apps/extension
   ```

   （必须是含 `manifest.json` 的那一层，不要选 monorepo 根目录。）

4. 工具栏出现 **repo-gossip**；没有的话点拼图图标固定一下

**更新代码后：** 回到扩展页，点卡片上的 **刷新**，必要时再刷新 GitHub 标签页。

Edge / 其他 Chromium 同理。

---

## 怎么用

### 工具栏出报

1. 点工具栏图标  
2. 首次先 **设置**：填 **API Base URL**（如 `http://localhost:5173`），可选 GitHub Token / LLM BYOK  
3. 粘贴仓库 → **出报**（生成时请保持弹层打开）  
4. 需要大屏 → **完整页面**  
5. 回看旧报 → chips 旁的 **最近**（点选复开缓存，不重新请求）

### GitHub 仓库页

1. 打开 `https://github.com/owner/repo`
2. 拖动「八卦小报」按钮到顺手位置（位置会记住）
3. 单击出报；侧栏 **最近** 与工具栏共用同一份历史
4. 点 `×` 只是隐藏面板，同仓再点可复开缓存；要新内容再点「重新出报」

### 扩展选项页

`chrome://extensions` → repo-gossip → **扩展程序选项**（与弹层设置同一套存储）。

---

## 配置

| 配置 | 必填 | 说明 |
|------|------|------|
| API Base URL | 是 | 后端根地址 → `{base}/api/gossip` |
| GitHub Token | 否 | 提高限额 / 私有仓 |
| LLM API Key 等 | 否 | BYOK；不填则用服务端 `.env`（若有） |
| 回溯天数 | 否 | 默认 14（1–90） |
| 仅本地模板 | 否 | 勾选后不调用 LLM |

---

## 打包分发（可选）

适合可信小范围分发，不是上架商店：

1. `chrome://extensions` → **打包扩展程序**
2. 根目录选 `apps/extension`
3. **不要**把 `.pem` 提交进 Git 或公开分享（仓库已 ignore `*.pem` / `*.crx`）
4. 私钥请只放在本机安全位置；丢失或泄露后应视为该签名身份已不可信

---

## 故障排除

| 现象 | 试试 |
|------|------|
| 连不上 / 出报失败 | API Base URL 能否在浏览器打开；本机是否已 `npm run web` |
| CORS / 网络失败 | 扩展经 background 发请求；确认后端在跑、URL 为 `http/https` |
| GitHub 页没有按钮 | 扩展已启用？路径是 `github.com/owner/repo`？刷新扩展后再刷页面 |
| 「最近」是空的 | 是否至少成功出报过一次？失败 / 加载中不会入库 |
| 侧边栏有、弹层没有（或反过来） | 两边应共用存储；试刷新扩展；确认未清掉站点数据 |
| LLM 失败 | 填 BYOK，或服务端配 LLM，或勾选「仅本地模板」 |
| 关掉弹层没结果 | 弹层关闭会中断请求；改用「完整页面」再出报 |

---

## 安全与隐私

- 不要在源码里硬编码密钥
- BYOK 仅存本机，只发往你填写的 API Base URL
- 未上架商店，更新需自行重新加载或分发新包

---

## 相关链接

- 项目总览与 API → [../../README.md](../../README.md)
- 架构说明 → [../../docs/architecture.md](../../docs/architecture.md)
- 许可证 → [MIT](../../LICENSE)
