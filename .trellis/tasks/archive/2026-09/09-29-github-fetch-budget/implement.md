# Implement: GitHub 抓取预算化

## Checklist (order)

1. **Config** — `packages/core/src/config.ts`：`envSchema` 增加 `GOSSIP_MAX_COMMIT_DETAILS`（`z.coerce.number().int().min(0).default(20)`）。
2. **纯函数** — `packages/core/src/github.ts`：
   - 导出 `DEFAULT_MAX_COMMIT_DETAILS = 20`
   - 导出 `messageScoreForDetail(c: { message: string; date: string }): number`
   - 导出 `pickCommitsForDetail(commits, budget): string[]`
   - 导出 `resolveDetailBudget(explicit?: number): number`
3. **接线** — `fetchRepoSnapshot`：先算 `wanted = new Set(pickCommitsForDetail(...))`，在 `mapPool` 内对不在集合里的 commit 直接 `toCommitStat(c)` 返回（不调 `getCommit`、不置 `statsIncomplete`）。
4. **签名** — `fetchRepoSnapshot` 的 options 增加可选 `maxCommitDetails?: number`（非必填，保持调用方零改动）。
5. **Exports** — `packages/core/src/index.ts` 导出新增的纯函数与常量。
6. **Env docs** — `.env.example` 加 `GOSSIP_MAX_COMMIT_DETAILS`；README 环境变量表补一行；`docs/architecture.md` 的 data flow 注释可补一句「commit 详情按预算采样」。
7. **Tests** — `test/github-fetch-budget.test.ts`：
   - `pickCommitsForDetail`：40 条 + 预算 20 → 长度 ≤ 20 且含最近 8 条
   - 预算 0 → 空数组
   - 同分 tie-break 稳定（同输入两次调用结果相同）
   - `resolveDetailBudget`：显式值 / env / 缺省三种来源
   - 打桩 octokit：预算 0 时 `repos.getCommit` 调用次数为 0，且 snapshot 可构造、`statsIncomplete` 未设置
   - 打桩 octokit：某次 `getCommit` 抛错 → `statsIncomplete === true`
8. **Typecheck / tests** — `npm test`、`npm run typecheck`。

## Validation

```bash
npm test
npm run typecheck -w @repo-gossip/core
npm run gossip -- vercel/next.js --offline        # 冒烟（offline 也走抓取，可验证不崩）
GOSSIP_MAX_COMMIT_DETAILS=0 npm run gossip -- vercel/next.js --offline   # 预算为 0 的退化路径
```

## Risky files

- `packages/core/src/github.ts` — 抓取主路径；`statsIncomplete` 语义极易写错（跳过 ≠ 失败）
- `packages/core/src/config.ts` — 影响三处 `loadEnv`

## Review gates

- [ ] 「因预算跳过」不设置 `statsIncomplete`、不产生 warnings
- [ ] `CommitStat` 形状未变
- [ ] `runGossip` 未新增必填参数
- [ ] 单测全部离线，用打桩 octokit，不真实调用 GitHub

## Rollback points

- 步骤 2 之后：只有新增纯函数，未接线，零风险
- 步骤 3 接线后：若冒烟发现奖项质量明显下降，只需把默认预算调回 40 即可（一行常量），无需回滚结构

## Explicitly not doing

- GraphQL 迁移、令牌体系、详情缓存
- 并发数（5）调整
- 调整 `MAX_COMMITS`（40）与默认 `sinceDays`（14）
- 把「跳过数」暴露为 warning
