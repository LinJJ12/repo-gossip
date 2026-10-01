# 实现记录 — 含金量徽章端点(2026-10-01)

## 代码改动

| 文件 | 内容 |
|------|------|
| `packages/core/src/badge.ts`(新增) | `formatBadgeSvg`(shields 风格双段 SVG,等级配色:足金 #d4a017/K金/镀金/掺水 #ff4d6d/贴纸/N/A 灰)、`badgeErrorSvg`、`resolveBadgeRepoParam`(owner/repo 严格校验 + .svg 后缀剥离)、`badgeTextWidth`(CJK 11px / ASCII 6.5px 估宽)。零依赖纯函数 |
| `api/badge/[owner]/[repo].ts`(新增) | Vercel 动态路由:GET only,公开访问(README 热链场景不需要 WEBHOOK_SECRET);缓存复用 `gossip-cache`(key format="badge",TTL ≥ 600s);`Cache-Control: public, max-age=3600, s-maxage=3600`;**任何失败都输出灰色 N/A 徽章 + HTTP 200**,README 永不破图 |
| `apps/web/vite.config.ts` | dev 中间件等价路由 `badgeApiPlugin` |
| `README.md` / `docs/architecture.md` | 徽章用法示例与管线登记 |

## 验证

- `npm test`:159 pass / 0 fail(新增 6 例:SVG 结构/等级配色/N/A 防御分支/路径校验)
- `npm run typecheck`(core/bot/web)全绿
- dev 服务器冒烟:
  - `GET /api/badge/vercel/next.js.svg` → 200 `image/svg+xml`,aria-label「含金量: 95 足金」,金级配色
  - 非法路径 → 400;不存在仓库 → 200 + 灰色 N/A(不破图)

## 已知限制

- 徽章宽度按字符类估算,CJK 与等宽字体混排可能有 ±2px 偏差(视觉可忽略)
- 多风格参数(flat-square 等)与点击跳转落地页在 Out of Scope
