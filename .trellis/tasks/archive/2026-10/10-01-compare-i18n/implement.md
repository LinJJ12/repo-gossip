# 实现记录 — 仓库对比与双语评分卡(2026-10-01)

## 代码改动

| 文件 | 内容 |
|------|------|
| `packages/core/src/types.ts` | 新增 `ScoreLocale`("zh" 默认 / "en") |
| `packages/core/src/score.ts` | 全文案抽入 STR 双语字典;`computeRepoScore`/`formatScoreCard`/`gradeFor`/`confidenceFromMissing` 均接受可选 locale;**zh 输出字节级不变**(162 个旧测试零改动通过) |
| `packages/core/src/watermark.ts` | notes 双语 + `watermarkLevelLabel(level, locale)` |
| `packages/core/src/badge.ts` | 徽章标签双语(含金量/Gold),`formatBadgeSvg`/`badgeErrorSvg` 接受 locale;`GRADE_COLORS` 导出供雷达复用 |
| `packages/core/src/compare.ts`(新增) | `parseCompareRepos`(2-4 个,逗号/空白/数组)、`formatCompareTable`(Markdown 对照表:总分/五维/置信度/含水量,N/A 列 + 失败原因)、`formatCompareRadarSvg`(零依赖五维雷达,等级配色) |
| `packages/core/src/gossip.ts` | `runCompare`(逐仓库独立评分,单个失败不拖垮);`runScore` 接 locale |
| `packages/core/src/cli.ts` | `--compare`(positionals 全为仓库)、`--lang <zh|en>`;修复 `--lang` 未被 parseArgs 消费导致 "en" 泄漏成仓库的 bug |
| `api/gossip.ts` | `mode:"compare"`(body repos / GET ?repos=)、`lang` 参数;compare 缓存键 = 仓库列表;GET 无 repo 健康检查语义保持 |
| `api/badge/[owner]/[repo].ts` | `?lang=en`;缓存键含 locale |
| `apps/web/vite.config.ts` | 中间件同等支持 compare/lang;修复 parseCompareRepos 从错误模块解构的 bug |
| `apps/web/src/{CompareView.tsx(新增),App.tsx,types.ts,styles.css}` | 验金输入逗号分隔 2-4 仓库 → 对比表 + 雷达 SVG + 图例(雷达在 Web 端独立渲染,不把 Octokit 打进浏览器包) |
| `test/compare.test.ts`(新增) | 12 例:入参规范化/边界、zh+en 表格、失败列、雷达结构、runCompare 集成(独立评分/失败列/数量校验)、en 等级与徽章 |

## 冒烟(真实 GitHub)

- `--compare vercel/next.js sindresorhus/is`:95·足金 vs 63·镀金,五维/置信度/含水量齐备
- `--compare --lang en`:Gold Comparison / Solid Gold / Influence…
- `--score --lang en`:Gold Report
- API POST/GET compare、score lang=en、单仓库 400、坏仓库 N/A 列、徽章 ?lang=en → "Gold: 95 Solid Gold"
- 浏览器 UI:验金输入逗号分隔双仓库 → 对比表 + 雷达 + 图例完整渲染

## 验证

- `npm test`:174 pass / 0 fail(zh 回归无损)
- `npm run typecheck`(core/bot/web/api)0 错误
- `npm run web:build` 通过

## 已知限制

- 雷达图为静态快照,无动画(PRD 允许)
- 对比 = N × 评分抓取(2 仓 ≈ 22-30 次调用),依赖缓存与 token
