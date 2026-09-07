# 公开API与BYOK契约

## Goal

浏览器与插件无需服务端 Webhook 密钥即可出报；支持 BYOK 请求头透传到 `runGossip`；保留内部密钥通道与紧急开关。

## Requirements

- 生产默认：无 `WEBHOOK_SECRET` 也可 POST/GET 生成（公开路径）。
- 若请求带有效 `Authorization: Bearer WEBHOOK_SECRET` / `x-webhook-secret`，视为内部调用。
- BYOK 头：`x-github-token`、`x-llm-api-key`、`x-llm-base-url`、`x-llm-model` → `runGossip({ env })`；优先级高于服务端 env。
- 不在日志/响应中回显密钥；提供 `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` 恢复旧强制鉴权。
- Web 生产路径可成功出报；CORS 或约定由扩展 background 发请求（与父 design 一致）。
- 更新 README/architecture 中与「生产必须 WEBHOOK_SECRET」矛盾的表述。

## Acceptance Criteria

- [x] 未设置 WEBHOOK_SECRET 或未带密钥时，公开仓 POST `/api/gossip` 可返回 tabloid。
- [x] 设置 `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` 且无密钥时拒绝。
- [x] 带 BYOK LLM Key 头时，core 使用该 Key（缺服务端 Key 时不再被迫 offline，除非 offline 标志）。
- [x] Web 预览在模拟生产鉴权策略下仍可出报。

## Depends

无（队列第一项）。
