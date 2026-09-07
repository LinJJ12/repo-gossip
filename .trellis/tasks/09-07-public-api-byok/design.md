# Design — 公开API与BYOK

## Auth policy

1. Health GET（无 `repo`）始终开放。
2. 若 `GOSSIP_REQUIRE_WEBHOOK_SECRET=1`：与旧行为相同——生产必须配置并校验 `WEBHOOK_SECRET`。
3. 否则：公开生成路径**不要求** Webhook 密钥；若请求携带正确 Bearer/`x-webhook-secret`，标记为 internal（供后续限流差异化，本任务可仅解析不使用）。
4. 若配置了 `WEBHOOK_SECRET` 且请求带了错误密钥 → 401（防探测时误用）。仅当「带了密钥头但不匹配」时 401；完全不带密钥则放行公开路径。

## BYOK

从请求头读取并传入 `runGossip({ env })`：

- `x-github-token` → GITHUB_TOKEN  
- `x-llm-api-key` → LLM_API_KEY  
- `x-llm-base-url` → LLM_BASE_URL  
- `x-llm-model` → LLM_MODEL  

Vite 开发中间件同样读取这些头，保持本地与生产一致。

## CORS

`OPTIONS` 返回允许的方法和头；`Access-Control-Allow-Origin` 用 `GOSSIP_CORS_ORIGINS`（逗号分隔）或 `*`（开发默认）。扩展将走 background fetch，仍一并支持。

## Files

- `api/_auth.ts` — 统一策略，供 gossip 使用  
- `api/gossip.ts` — 接入 BYOK + CORS + 新 authorize  
- `apps/web/vite.config.ts` — BYOK 头  
- `README.md` / `docs/architecture.md` — 文档  
- `.env.example` — 新变量说明  
- `test/` — 鉴权/BYOK 纯函数测试（若把解析抽到可测模块）
