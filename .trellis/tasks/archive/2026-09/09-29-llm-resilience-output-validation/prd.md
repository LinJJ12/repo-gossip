# LLM 调用韧性与输出校验

## Goal

让 LLM 环节从「要么完美、要么全废」变成有梯度的降级：请求有超时上限，输出解析失败时先自修再降级，且**只降级坏掉的那一个字段**而不是整份小报。目标是显著减少 `mode: "fallback"` 的出现，同时不让一次慢请求拖垮 Serverless 函数。

## Background

`packages/core/src/llm.ts` 今日的行为：

- `chatCompletion` 的 `fetch` 未传 `signal`（`llm.ts:133`）。模型侧慢或连接挂死时，请求会一直挂着，直到宿主（Vercel）超时才被杀掉——用户只拿到一个 504，且白白占用函数实例。
- `response_format: json_object` 失败时会降级重发一次（好事），但随后 `parseTabloidJson` 里只有一次 `JSON.parse`（`llm.ts:166`）。只要 LLM 多吐一句前缀、用了单引号、或尾随逗号，**整份 LLM 成果被丢弃**，直接走 `fallbackTabloid`。
- `generateTabloid` 的 `try/catch` 包住了整个流程，任何解析异常都统一落到 fallback，没有字段级容错。
- 字段读取已用 `String(...)` / `Array.isArray` 做防御，但缺少「该项无效 → 用本地值补位」的机制。

## Requirements

1. **请求超时**：`chatCompletion` 的每次 `fetch` 必须带中断信号，超时上限来自可选环境变量（默认 20s，见 Open Questions）。超时按「一次请求」计，不含重试累加的等待以外的语义复杂化——简单实现即可。
2. **超时后的行为**：超时归入现有失败路径——`generateTabloid` 返回 `mode: "fallback"` 且设置 `llmError`，消息可操作（说明是 LLM 超时）。不得抛出未捕获异常。
3. **解析修复**：`JSON.parse` 失败时，先做一次**确定性的**文本修复再试一次（剥离 markdown 代码围栏、截首尾花括号、去掉 BOM/前后空白）。修复只允许这两类操作，**不做**引号替换、尾逗号删除等语义级重写。
4. **字段级降级**：修复后仍无法解析，或解析成功但某个字段缺失/类型不对时——
   - `epicTitle` / `temperatureLine` / `closing` → 用 `fallbackTitle` / 温度行 / 默认结语补位；
   - `awardsNarrative` → 用 `analyzed.awards` 渲染的本地行补位；
   - `easterEggLines` → 用 `analyzed.easterEggs` 渲染的本地行补位；
   - `translations` → 沿用现有「空或全空 drama 时回落到 `notableCommits` + `dramatizeLocally`」规则；
   - **只要解析出的对象里至少有一项可用字段，就不得整单 fallback。**
5. **保留整单 fallback**：只有当「HTTP 失败 / 超时 / 空内容 / 解析彻底失败且无任何可用字段」时才走 `fallbackTabloid`，此时 `mode` 必须是 `"fallback"` 且 `llmError` 非空。
6. **暴露可测的纯函数**：解析与修复逻辑必须能从 `llm.ts` 导出为纯函数，供单测直接调用（不发起网络）。
7. **环境变量**：新增可选 `LLM_TIMEOUT_MS`，默认 20000；在 `packages/core/src/config.ts` 的 `envSchema` 登记，并在 `.env.example` 写明。缺省行为与今日一致。
8. **日志**：超时/解析失败沿用现有 `console.error("[llm]", …)` 风格，**不得**打印 `apiKey`、请求体或任何 BYOK 值。

## Acceptance Criteria

- [x] `chatCompletion` 的 `fetch` 带中断信号；用注入的 `fetch` 打桩可在单测里断言 `signal` 已传入。
- [x] 单测：注入一个永不 resolve 的 `fetch`，`generateTabloid` 在超时预算内返回 `mode: "fallback"` 且 `llmError` 包含「超时」语义，测试本身耗时远小于默认超时（通过可注入的超时参数实现）。
- [x] 单测：LLM 返回带 ```json 围栏 + 前后废话的文本 → 正常解析出字段，`mode` 为 `"llm"`。
- [x] 单测：LLM 返回缺 `closing`、且 `awardsNarrative` 是字符串而非数组 → 这两个字段各自用本地值补位，`epicTitle` 仍取 LLM 的值，`mode` 仍为 `"llm"`。
- [x] 单测：LLM 返回完全非 JSON 垃圾 → 走 `fallbackTabloid`，`mode: "fallback"`，`llmError` 非空。
- [x] 无 `LLM_API_KEY` / `--offline` 路径不受影响（仍走 `buildOfflineTabloid`）。
- [x] `npm test` 与 `npm run typecheck` 全绿；测试**不发起真实网络请求**。

## 实现记录（2026-09-29）

- 代码改动：`packages/core/src/{config,llm,gossip,index}.ts` —— 新增 `LLM_TIMEOUT_MS`（默认 20000）、`AbortSignal.timeout` 注入；`parseTabloidJson` 拆为 `normalizeRawJson` + `safeParseTabloid`（均导出、纯函数、不抛）；字段级补位表全部实现；`generateTabloid` 仅在「零可用字段」时整单 fallback。
- 新增 `test/llm-resilience.test.ts`（11 个用例，全绿）。全量 `npm test`：90 pass / 0 fail / 0 cancelled。`npm run typecheck -w @repo-gossip/core` 通过。
- 离线冒烟通过：`npm run gossip -- vercel/next.js --offline` 正常产出 `[mode=offline]` 小报，LLM 路径改动未影响离线分支。
- 环境变量文档：`.env.example` 与 `README.md` 环境变量表均补 `LLM_TIMEOUT_MS`。

### 测试陷阱（可复用）

`node:test` 下 `AbortSignal.timeout(ms)` 的内部定时器**不会**阻止事件循环被判定为「已 resolved」，导致整个 suite 被 `cancelledByParent`（报错 `Promise resolution is still pending but the event loop has already resolved`）。真实 Node 运行时该定时器正常触发，故生产代码用 `AbortSignal.timeout` 没问题。**测试超时/中断分支时**：用真实 `setTimeout` 在打桩 `fetch` 里主动 `reject(new AbortError)` 驱动中断（同时仍挂 `signal.addEventListener('abort', …)` 以兼容真实运行时），再单独用一个用例断言 `init.signal` 已传入。

## Out of Scope

- 重试次数调整、退避策略（今日的 `response_format` 降级重发保持不变）
- 流式输出、function calling、多模型路由
- 引入 zod 做 LLM 输出 schema 校验（本任务用手写类型守卫，保持与 `quality-guidelines.md` 一致）
- 提示词（SYSTEM_PROMPT）内容调优
- 并发/批量出报

## Key Decisions

| 决策 | 结论 |
|------|------|
| 超时实现 | `AbortSignal.timeout(ms)`，Node ≥ 18 可用；超时参数可由调用方注入以便测试 |
| 解析修复范围 | 仅「剥围栏 + 截首尾花括号 + trim」，不做语义级重写 |
| 降级粒度 | 字段级；整单 fallback 只在无任何可用字段时发生 |
| 新增环境变量 | 仅 `LLM_TIMEOUT_MS`（可选，默认 20000） |
| 是否引入 zod schema | 否，保持手写守卫 |

## Open Questions

1. 默认超时 20s 是否合适？若部署目标是 Vercel Hobby（10s 上限）应降到 8s。实现时按 Open Question 处理，先取 20s 并在 `.env.example` 注明可调。
