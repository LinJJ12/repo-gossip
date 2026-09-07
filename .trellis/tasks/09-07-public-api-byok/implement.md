# Implement — 公开API与BYOK

- [x] 重构 `api/_auth.ts`：公开默认 + kill-switch + 错误密钥 401
- [x] `api/gossip.ts`：BYOK 提取、CORS/OPTIONS、`runGossip({ env })`
- [x] Vite middleware 透传 BYOK
- [x] 可测的 header→env 纯函数（`packages/core/src/byok.ts`）+ 单测
- [x] 更新 README / architecture / `.env.example`
- [x] `npm test` && `npm run typecheck`
