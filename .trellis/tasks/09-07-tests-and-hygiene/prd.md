# 测试与工程卫生

## Goal

补强核心/API 测试；鉴权去重。ESLint 可后续加（本轮优先行为测试）。

## Requirements

- 测试覆盖：BYOK/鉴权矩阵、rate-limit/cache、GitHub retry、Telegram args。
- `api/_auth.ts` 与 gossip 共用 `decideWebhookAuth`（core）。
- ESLint：未强制引入（避免本轮额外依赖安装）；建议 follow-up。

## Acceptance Criteria

- [x] `npm test` 覆盖新增行为；`npm run typecheck` 通过。
- [x] 鉴权无双份分叉实现（决策在 `packages/core/src/byok.ts`）。
- [ ] ESLint 流水线（延期）。

## Depends

建议在 1–4 行为稳定后收口。
