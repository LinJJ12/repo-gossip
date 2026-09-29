# repo-gossip 管线韧性与质量改良

## Goal

在不改变外部契约（`/api/gossip` 请求/响应、LLM JSON 英文字段集、CLI 参数、`runGossip` 必填参数）的前提下，把出报管线的**可靠性**与**可维护性**系统性提一档：让 LLM 侧不再因为一次超时或一次轻微格式问题就整单降级，让 GitHub 侧不再用约 45 次 API 调用换一份小报，并给容易回归的纯逻辑补上单测。同时收尾两个长期停留在 `in_progress`、代码其实已落地的任务。

## Background

本轮规划基于两个已落地 PRD（`09-07-web-history-localStorage`、`09-15-content-quality-activity-signals`）加上一轮代码审计。`npm test` 当前 **79 passed / 0 failed**，`npm run typecheck` 干净，说明功能层面是健康的——剩下的是韧性与结构债：

| # | 现状 | 证据 |
|---|------|------|
| 1 | LLM 请求无超时/中断，慢模型或挂死连接会一直拖到 Serverless 函数超时 | `packages/core/src/llm.ts:133` `fetch` 未传 `signal` |
| 2 | LLM 输出只做一次 `JSON.parse`，失败即整单降级为本地模板，轻微格式问题也丢掉全部 LLM 质量 | `packages/core/src/llm.ts:166-208` |
| 3 | 一次出报对每个 commit 逐个 `repos.getCommit`（并发 5），约 45 次 GitHub API 调用；无 token 时极易撞 403 / secondary limit | `packages/core/src/github.ts:52-66` |
| 4 | `parseTabloidJson`、`toDiscordEmbed` / `toFeishuCard`、Release 窗口过滤、issue 去 PR 都是纯逻辑但无单测 | `test/` 仅 9 个文件，无对应覆盖 |
| 5 | 两个任务 `task.json` 仍为 `in_progress`，代码与测试都已在 `9f01a99` / `89797cc` 落地 | `.trellis/tasks/` |

## Scope

本父任务只做**可靠性与可维护性**改良，不做新功能、不做新栏目、不做新渠道。

## Task Map

| 子任务 | 优先级 | 负责范围 | 独立性 |
|--------|:---:|---------|--------|
| `09-29-llm-resilience-output-validation` | P1 | `packages/core/src/llm.ts`（+ `config.ts` 新增超时环境变量） | 可独立验收 |
| `09-29-github-fetch-budget` | P1 | `packages/core/src/github.ts`（+ `config.ts` 新增抓取预算环境变量） | 可独立验收 |
| `09-29-core-contract-tests` | P2 | `test/` 新增 fixture 单测 | 可独立验收 |
| `09-29-closeout-archive-in-progress` | P2 | `.trellis/tasks/` 两个遗留任务的状态收尾 | 可独立验收 |

依赖说明（写在子任务里，不由树结构隐含）：
- `core-contract-tests` 若要覆盖 `parseTabloidJson` 的新行为，其断言需与 `llm-resilience-output-validation` 落地后的契约一致——**建议顺序**：先做 P1 两个，再做 `core-contract-tests`。
- 三个代码子任务互不阻塞，可任意顺序。
- `closeout-archive-in-progress` 与代码改动无关，可随时做。

## Shared Constraints（跨子任务，必须都遵守）

1. **不改外部契约**：`/api/gossip` 的请求字段与响应形状不变；CLI 参数不变；`runGossip` 不新增必填参数。
2. **不改 LLM JSON 英文字段集**：`epicTitle` / `awardsNarrative` / `temperatureLine` / `translations` / `easterEggLines` / `closing` 保持不变。
3. **不改 mode 语义**：`llm` / `offline` / `fallback` 三态含义不变；`fallback` 仍必须设置 `llmError`。
4. **人读文案保持中文**，JSON key 保持英文（spec `core/backend/index.md`）。
5. **测试不得依赖 LLM**：offline / 本地模板路径必须始终可测（spec `core/backend/quality-guidelines.md`）。
6. **业务留在 core**：适配层（api / bot / web / extension）不复制管线逻辑。
7. **不记录、不回显 BYOK 与 webhook 密钥**。
8. 新环境变量一律**可选**，默认值保持今日行为；在 `.env.example` 与 README 环境变量表同步登记。

## Cross-Child Acceptance Criteria

- [x] `npm test` 与 `npm run typecheck` 全绿（含三个 workspaces）。实测：121 pass / 0 fail / 0 cancelled；`npm run typecheck -w @repo-gossip/core` 干净。
- [x] `npm run gossip -- <owner/repo> --offline` 冒烟可出报，输出不劣化。vercel/next.js 离线出报栏目齐全；`GOSSIP_MAX_COMMIT_DETAILS=0` 退化为纯列表出报仍正常。
- [x] 无 `LLM_API_KEY` 时行为与今日一致（走 offline + `llmError`）。超时/解析失败也统一走 `fallback` 且 `llmError` 非空（child 1）。
- [x] `/api/gossip` 的响应形状与既有集成（Web / 扩展 / Bot）无需改动。`CommitStat` / `RepoSnapshot` / `Tabloid` 形状未变，新增符号均为可选配置或测试用纯函数。
- [x] README / `docs/architecture.md` 中与实际行为冲突的表述已同步。两者均补 `LLM_TIMEOUT_MS` 与 `GOSSIP_MAX_COMMIT_DETAILS`，architecture 补 commit 详情采样说明。
- [x] 两个遗留 `in_progress` 任务已核对并归档，`.trellis/tasks/` 下不再有已完成却未收尾的任务。

## 集成复核记录（2026-09-29）

四个子任务全部实现、单测通过并归档，父任务达成「可靠性 + 可维护性」目标：

1. **LLM 韧性**（child 1）：超时 20s 默认、`AbortSignal.timeout` 注入；解析失败先做确定性修复再字段级补位，仅当零可用字段才整单 fallback。新增 `test/llm-resilience.test.ts`（11 例）。
2. **GitHub 预算**（child 2）：`GOSSIP_MAX_COMMIT_DETAILS` 默认 20，一次出报 getCommit 调用由 ~45 降到 ≤25；跳过 ≠ 失败（`statsIncomplete` 语义不变）。新增 `test/github-fetch-budget.test.ts`（15 例）。
3. **核心契约单测**（child 3）：抽取 `filterNonPullIssues` / `mapReleasesInWindow`（行为不变），补 `safeParseTabloid` / `toDiscordEmbed` / `toFeishuCard` / Release 窗口 / Issue 去 PR 测试。新增 `test/core-contract.test.ts`（16 例）。
4. **收尾归档**（child 4）：核对并归档 `09-15-content-quality-activity-signals` 与 `09-07-web-history-localStorage`，仅文档收尾无代码改动。

**外部契约零变更核验**：`/api/gossip` 响应、`runGossip` 必填签名、CLI 参数、`LLM_*` 英文字段集、三态 `mode` 语义均保持不变；所有新增项均为可选环境变量或测试用导出纯函数。

全量 `npm test`：79（基线）→ 121（本轮 +42 例），0 fail / 0 cancelled。

## Out of Scope

- 新功能 / 新栏目 / 新渠道（飞书、Discord Interactions Ed25519、Gitee、账号体系）
- Web ↔ 扩展历史同步、云端历史
- 分布式限流与共享缓存（Redis / Upstash）
- 扩展前端 `app.js` / `content.js` 大文件拆分（已识别，另立任务）
- 默认 `sinceDays` 调整、双语气（严肃 brief）

## Open Questions

1. LLM 超时的默认值取多少？倾向 20s（Serverless 常见 60s 上限内留足余量），可在实现时确认。
2. `statsIncomplete` 是否需要暴露"跳过了多少个 commit 详情"？倾向先用现有布尔语义，避免过度设计。
