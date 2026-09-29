# GitHub 抓取预算化

## Goal

把一次出报的 GitHub API 调用数从「约 45 次」降下来：commit 详情不再逐个无差别抓取，而是按可解释的打分选出 top-N 再拉详情。目标是显著降低无 token 场景撞 403 / secondary rate limit 的概率，同时把对出报质量的影响限制在可说明、可调的范围内。

## Background

`packages/core/src/github.ts` 的 `fetchRepoSnapshot`：

1. `repos.get`（1 次）
2. `repos.listCommits`（1 次，`since` 窗口内，最多 40）
3. 对 `commitList.slice(0, 40)` **每一个**调 `repos.getCommit`（并发 5）→ 最多 40 次
4. `fetchActivity`（3 次：pulls / issues / releases）

即一次出报约 **45 次** GitHub 调用。未配 `GITHUB_TOKEN` 时限额是 60 次/小时/IP，意味着**两个请求就可能触顶**；即使有 token（5000/小时），40 次串行+并发的详情抓取也贡献了绝大部分延迟。

而详情（`stats` / `files`）实际只服务于三件事：
- 奖项：代码清道夫（`deletions > additions`）、拆迁办（`additions + deletions >= 200`）
- `pickNotable` 打分中的 LOC 项
- 彩蛋侦探里的 `files` 匹配

提交计数、作者排行、温度、夜猫子、废话文学金句奖**都不依赖详情**——它们用 `listCommits` 的基础信息就够了。

## Requirements

1. **引入抓取预算**：新增可选环境变量 `GOSSIP_MAX_COMMIT_DETAILS`（默认 20）。一次出报最多只对 N 个 commit 拉详情。
2. **可解释的选取规则**（纯函数，可单测）：候选集 = 「按 message 启发式打分 top-12」∪「窗口内最近 8 个」，去重后取前 N。打分复用 analyzer 已有的直觉信号，不得引入网络调用。
3. **未拉详情的 commit 保留基础信息**：从 `listCommits` 的 payload 构造 `CommitStat`，`additions` / `deletions` 为 `0`，`files` 为空数组；其余字段（sha / message / author / date）与今日一致。
4. **不谎报降级**：`statsIncomplete` **仅在详情请求真的失败时**置 true（今日语义不变）。因预算而主动跳过**不算失败**，不产生 warnings。
5. **调用数可观测**：在实现里保留一个可测的纯函数，能算出「本次打算拉多少个详情」，供单测断言预算生效；日志（可选）记录预算与跳过数，不打印 token。
6. **默认值保守**：默认预算取 20（约把调用数从 45 降到 25），保证 LOC 类奖项仍有足够候选；设为 `0` 时退化为「完全不拉详情」（仍可出报）。
7. **环境变量登记**：`GOSSIP_MAX_COMMIT_DETAILS` 进 `config.ts` 的 `envSchema`、`.env.example` 与 README 环境变量表。
8. **不改外部契约**：`RepoSnapshot` / `CommitStat` 形状不变，`runGossip` 签名不变，CLI 参数不变。

## Acceptance Criteria

- [x] 单测：40 个 commit 且预算为 20 时，选取结果长度 ≤ 20，且包含窗口内最近 8 个。
- [x] 单测：预算为 0 → 不发起任何 `getCommit`（用打桩的 octokit 断言调用次数为 0），snapshot 仍可构造、仍可出报。
- [x] 单测：选取函数为纯函数，相同输入输出稳定（可排序确定性）。
- [x] 单测：`statsIncomplete` 在「详情请求抛错」时为 true，在「因预算跳过」时为 undefined/false。
- [x] `npm test` 与 `npm run typecheck` 全绿；`npm run gossip -- <owner/repo> --offline` 冒烟可出报。
- [x] 有 token 时对比改动前后：同一仓库小报仍含温度、MVP、夜猫子等不依赖详情的栏目。

## 实现记录（2026-09-29）

- 代码改动：`packages/core/src/{config,github,index}.ts` + `test/github-fetch-budget.test.ts`（15 例）+ `docs/architecture.md` 数据流注。
- 新增可测纯函数：`DEFAULT_MAX_COMMIT_DETAILS=20`、`messageScoreForDetail`、`pickCommitsForDetail`（top-12 启发式 ∪ 最近 8，去重后按原序取前 N）、`resolveDetailBudget`（显式 > env > 默认）。
- `fetchRepoSnapshot` 新增可选 `maxCommitDetails`；不在 `wanted` 集合的 commit 直接 `toCommitStat(c)` 返回（不调 `getCommit`、不置 `statsIncomplete`）——「主动跳过 ≠ 失败」语义成立。
- 全量 `npm test`：105 pass / 0 fail / 0 cancelled。`npm run typecheck -w @repo-gossip/core` 通过。
- 离线冒烟：`--offline` 正常出报；`GOSSIP_MAX_COMMIT_DETAILS=0` 退化为纯列表出报，栏目齐全、不误报 `statsIncomplete`。

## Out of Scope

- 换用 GraphQL API（v4）批量取 stats
- 引入 GitHub App / 安装令牌、分布式限额管理
- 缓存 commit 详情到磁盘或 Redis
- 改动 PR / Issue / Release 三路抓取（它们各只 1 次，不是瓶颈）
- 调整默认 `sinceDays` 与 `MAX_COMMITS`

## Key Decisions

| 决策 | 结论 |
|------|------|
| 默认预算 | 20（从 40 减半，保守优先） |
| 选取策略 | 启发式打分 top-12 ∪ 最近 8，取前 N |
| 跳过是否算降级 | **不算**；`statsIncomplete` 语义保持「请求失败」 |
| 未取详情的字段 | `additions=0` / `deletions=0` / `files=[]` |
| 预算为 0 | 允许，退化为纯 list 出报 |
| 已知影响 | LOC 类奖项（清道夫 / 拆迁办）与 `files` 类彩蛋变为「采样内最佳」，非全量最优 |

## Open Questions

1. 默认 20 是否仍需下调？可在冒烟时看实际命中率再定；因是环境变量，调整成本极低。
2. 是否要把「跳过了多少详情」作为 warning 暴露给用户？倾向**不暴露**（避免噪声），只在需要排障时靠日志。
