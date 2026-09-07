# Chrome插件GitHub注入

## Goal

Chrome MV3：在 GitHub 仓库页一键出报；Options 配置 API 与 BYOK；经 background 调公开 API。开源 sideload / 可打包，不上架商店。

## Requirements

- 包位置：`apps/extension`。
- Content script：匹配 `github.com/*/*` 仓库页注入按钮。
- Options：API Base URL、GitHub Token、LLM API Key、LLM Base URL、LLM Model；`chrome.storage.local`。
- Background：`fetch` POST `/api/gossip`，附加 BYOK 头；结果面板展示。
- README：开发者模式加载；可选打包 crx。

## Acceptance Criteria

- [x] 未填密钥时对公开仓可出报（依赖已部署公开 API / 本地 web）。
- [x] 填写 BYOK 后请求带对应头。
- [x] 不在扩展代码中硬编码服务端 WEBHOOK_SECRET。
- [x] 陌生人按 README 能从本仓库自行加载扩展试用。

## Depends

`09-07-public-api-byok`；最好已有 `09-07-rate-limit-cache`。
