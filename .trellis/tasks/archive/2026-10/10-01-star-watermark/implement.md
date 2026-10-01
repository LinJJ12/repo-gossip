# 实现记录 — 含水量检测(2026-10-01)

## 代码改动

| 文件 | 内容 |
|------|------|
| `packages/core/src/watermark.ts`(新增) | 纯函数:`starSeriesByDay`(按 UTC 天聚合)、`detectStarBursts`(单日 ≥ max(40, 均值+3σ) → high;连续 ≤3 天堆量 ≥ max(80, 基线) → medium)、`estimateWatermark`(突发 18-30%/窗 + sanity fail 12%/warn 5%,封顶 95%,分级 clean/suspicious/high-risk) |
| `packages/core/src/github-score.ts` | `fetchStargazerTimeline`:star ≥ 500 才抓,`star+json` media type,≤4 页×100;低星主动跳过(`starTimelineSkipped`,不算缺失),失败登记 `stargazers` |
| `packages/core/src/score.ts` | `RepoScoreInput` 增 `starredAt`/`starTimelineSkipped`;`RepoScore` 增 `watermark`;信用度 = sanity 扣分 − 含水量×60% 折算;评分卡 hero 行 + 信用度证据行展示含水量 |
| `apps/web/src/{types.ts,ScoreView.tsx}` | 含水量展示(hero 常驻 + 「含水量依据」notes 区块,仅非 clean 时展开) |
| `test/watermark.test.ts`(新增)+ score 测试夹具更新 | 12 例:聚合/排序/无效输入、平稳不误报、单日尖峰 high、3 天堆量 medium、分级边界、三态降级语义 |

## 真实环境的重要发现

**GitHub `GET /repos/{o}/{r}/stargazers` 当前在本环境稳定返回 404**(带/不带 token、带/不带 `star+json` 均复现;token 本身有效——`/user` 200)。未查到官方弃用公告,疑似代理出口 IP 触发滥用检测或端点新限制。已按三态语义优雅降级:

- `covered`(拿到时间线)→ 突发检测
- `skipped`(低星主动跳过)→ 不扣置信度
- `failed`(抓取失败)→ 登记缺失信号,置信度 −5,仅按比例信号估计含水量

若端点恢复,时间线检测自动生效,无需改代码。替代数据源(GHArchive / star-history)记录在 P2 备选。

## 验证

- `npm test`:153 pass / 0 fail(新增 12 例)
- `npm run typecheck`(core/bot/web)全绿
- 真实冒烟 next.js:95/100 足金,含水量 clean(star 时间线 404 → failed 态,比例信号全部通过)
- CLI `--score` 冒烟通过

## Out of Scope(遗留)

- stargazer 账号画像(账号年龄/公开仓库数)——需每用户额外请求
- GHArchive 全量对账(P2 数据源升级)
