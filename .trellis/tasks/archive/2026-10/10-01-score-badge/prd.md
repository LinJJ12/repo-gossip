# 含金量徽章端点

## Goal

提供 `GET /api/badge/:owner/:repo.svg` 评分徽章，可嵌入任意 README（对标 shields.io / libraries.io SourceRank 徽章），构成最便宜的病毒传播渠道。

## Requirements

1. **新 Serverless `api/badge.ts`**（+ Vite dev 中间件等价路由）：解析 `owner/repo.svg`，内部复用 `runScore`（走缓存）。
2. **SVG 手绘**：不引入第三方依赖，shields 风格双段徽章（`含金量` + `82·足金`），按等级配色（足金 #d4a017 / K金 / 镀金 / 掺水 / 贴纸）。
3. **缓存与限额**：结果缓存复用 `gossip-cache`（键含 `mode=badge`）；`Cache-Control: public, max-age=3600`；失败时输出灰色 `含金量|N/A` 徽章，HTTP 仍 200（避免 README 上破图）。
4. **安全**：`owner/repo` 严格校验（复用 `isGithubFullName` 语义）；不回显任何 token；可选 `WEBHOOK_SECRET` 语义与 `/api/gossip` 一致。
5. **登记**：README 增加徽章用法示例。

## Acceptance Criteria

- [x] 单测：SVG 输出包含分数与等级色；非法 repo 名 400；缓存命中不重复抓取（打桩断言）。
- [x] Vercel 本地（`vercel dev` 或 dev 中间件）冒烟：浏览器访问得到合法 SVG。
- [x] `npm test`、typecheck 全绿。

## Out of Scope

- 扁平/flat-square 等多风格参数（先出一种）
- 徽章点击跳转落地页（随 Web 评分卡后续任务）

## Key Decisions

| 决策 | 结论 |
|------|------|
| 依赖 | 零依赖手绘 SVG（shields 单文件做法），避免引包 |
| 失败语义 | 永远输出合法 SVG（N/A 灰徽章），200 |
