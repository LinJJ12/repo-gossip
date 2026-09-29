# Design: GitHub 抓取预算化

## 影响范围

只动 `packages/core/src/github.ts` 与 `packages/core/src/config.ts`。`analyzer.ts` / `gossip.ts` / 适配层不变（`CommitStat` 形状不变）。

## 现状

```ts
const [detailed, activity] = await Promise.all([
  mapPool(commitList.slice(0, maxCommits), 5, async (c) => {
    try { return toCommitStat(await octokit.repos.getCommit(...)); }
    catch { statsIncomplete = true; return toCommitStat(c); }   // list 级兜底
  }),
  fetchActivity(...),
]);
```

注意：`toCommitStat(c)` 这条兜底路径**已经存在**——未取到详情的 commit 本来就会带着 `additions=0 / deletions=0 / files=[]` 进入 snapshot。也就是说「不带 stats 的 CommitStat」是既有形状，本任务只是让它**主动、可控地**发生，而不是只在失败时发生。这大幅降低了兼容性风险。

## 目标形状

```ts
// 纯函数，可单测
export function pickCommitsForDetail(
  commits: { sha: string; message: string; date: string }[],
  budget: number,
): string[];   // 返回应拉详情的 sha 列表

// fetchRepoSnapshot 内
const budget = resolveDetailBudget(options?.maxCommitDetails);
const wanted = new Set(pickCommitsForDetail(commitList.slice(0, maxCommits), budget));
const detailed = await mapPool(list, 5, async (c) => {
  if (!wanted.has(c.sha)) return toCommitStat(c);          // 主动跳过，不算失败
  try { return toCommitStat(await octokit.repos.getCommit(...)); }
  catch { statsIncomplete = true; return toCommitStat(c); }
});
```

## 选取规则

```
候选 A = 按 messageScore 降序取前 12
候选 B = 按 date 降序取前 8
结果   = 去重(A ∪ B) 后按原 list 顺序取前 min(budget, 总数)
```

`messageScore`（与 `analyzer.ts` 的 `pickNotable` 直觉一致，但只用 list 级可得的信息）：

| 信号 | 分值 |
|------|:---:|
| `/fix|bug|hotfix|urgent/i` 命中 message | +4 |
| message 长度 < 12 | +3 |
| UTC 小时 < 5（夜猫子信号） | +2 |

> 不把 LOC 纳入打分——LOC 只有拉了详情才知道，正是要省掉的开销。

**确定性**：同分时以 `sha` 升序作为稳定 tie-break，保证纯函数输出可复现。

## 为什么「最近 8 个」无条件纳入

- 保底新鲜度：温度、MVP 等奖项主要看近期活动，最近的提交即使 message 平凡也应带 stats 参与 LOC 类奖项。
- 避免启发式全 miss 的极端情况（例如窗口内 40 条全是 `chore: bump`）。

## `statsIncomplete` 语义（重要）

| 情况 | `statsIncomplete` | warnings |
|------|:---:|---------|
| 详情请求抛错 | `true` | 有（今日文案不变） |
| 因预算主动跳过 | 不设置 | 无 |

理由：warnings 是给用户看的「数据可能不准」提示；主动采样是设计内的行为，不该污染告警。今日文案「部分提交详情拉取失败，增删行统计可能不完整」保持不变。

## 预算解析

```ts
function resolveDetailBudget(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.GOSSIP_MAX_COMMIT_DETAILS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return Math.floor(fromEnv);
  return DEFAULT_MAX_COMMIT_DETAILS;   // 20
}
```

`envSchema` 里登记为 `z.coerce.number().int().min(0).default(20)`，但 `fetchRepoSnapshot` 走显式参数/直接读 env，避免给所有调用方强加 env 依赖（与 `sinceDays` 的处理方式保持一致）。

## 调用数预估

| 阶段 | 今日 | 预算 20 后 |
|------|:---:|:---:|
| `repos.get` | 1 | 1 |
| `listCommits` | 1 | 1 |
| `getCommit` | ≤ 40 | ≤ 20 |
| `fetchActivity` | 3 | 3 |
| **合计** | **≈ 45** | **≈ 25** |

## 质量影响与缓解

| 栏目 | 是否受影响 | 说明 |
|------|:---:|------|
| 项目体温 / 提交计数 | 否 | 只用 list 级信息 |
| 本周 MVP / 夜猫子 / 废话文学金句奖 | 否 | 只用 message / author / date |
| 提交信翻译 | 否 | 只用 message |
| 代码清道夫奖 / 拆迁办奖 | **是** | 只在采样内取最优，可能漏掉未采样的超大改动 |
| 彩蛋侦探（`files` 匹配） | **是** | 未采样 commit 的 `files` 为空，只靠 message 匹配 |
| PR / Issue / Release 相关 | 否 | `fetchActivity` 不变 |

缓解：默认预算取 20（半数），且采样偏向「修复类 / 短消息 / 深夜」——恰好也是彩蛋与 LOC 奖项的高概率区间。预算为环境变量，可按实际效果上调。

## 兼容性

- `RepoSnapshot` / `CommitStat` 形状不变 → `analyzer`、`format`、`api`、`web`、`extension` 全无感。
- `runGossip` 签名不变，不新增必填参数（新增的是可选 `maxCommitDetails`，仅内部/测试使用）。
- 不设置 `GOSSIP_MAX_COMMIT_DETAILS` 时行为变化仅为「最多 40 → 最多 20 次详情抓取」。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| LOC 类奖项漏掉最优候选 | 默认预算保守（20）；最近 8 条无条件纳入 |
| 启发式打分与 analyzer 重复 | 打分函数留在 `github.ts` 并命名为 `messageScoreForDetail`，明确「这是抓取前的预算打分，不是出报打分」，避免误复用 |
| 并发仍为 5，延迟下降有限 | 调用数减半已是主要收益；并发数不在本任务调整 |

回滚：改动集中在 `github.ts`，`git revert` 即可；无存储/契约变更。

## 不做的事

- GraphQL 迁移、令牌体系改造
- 详情缓存
- 并发数调整
- 调整 `MAX_COMMITS` / 默认 `sinceDays`
