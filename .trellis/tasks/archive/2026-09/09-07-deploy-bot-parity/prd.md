# 部署与Bot对等

## Goal

理清 Vercel 上 Web+API 部署；Bot 支持 days/offline；Discord serverless 未完成则文档标明仅长驻。

## Requirements

- `vercel.json` / 文档：如何同时提供 API 与 web 静态。
- Discord/Telegram：`runGossip` 传入可配置 days/offline。
- README：Discord webhook 501 边界。

## Acceptance Criteria

- [x] 新贡献者按文档能判断生产入口是 Web、插件还是仅 API。
- [x] 至少一个 Bot 平台可指定 days 或 offline。

## Depends

公开 API 稳定后更新文档更不易打架。
