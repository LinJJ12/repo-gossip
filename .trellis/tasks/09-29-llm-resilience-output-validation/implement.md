# Implement: LLM 调用韧性与输出校验

## Checklist (order)

1. **Config** — `packages/core/src/config.ts`：`envSchema` 增加 `LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20000)`（注意与 `loadEnv` 的取值方式一致）；确认缺省解析结果为 20000。
2. **Timeout** — `packages/core/src/llm.ts` `chatCompletion`：新增可选 `options: { timeoutMs?: number; fetchImpl?: typeof fetch }`；每次 `fetch` 传 `signal: AbortSignal.timeout(timeoutMs)`；`AbortError` 归一化为 `LLM request timed out after ${timeoutMs}ms`。加 `typeof AbortSignal.timeout === "function"` 守卫。
3. **Extract parser** — 把 `parseTabloidJson` 拆成：
   - `normalizeRawJson(raw)`（纯函数，导出）
   - `safeParseTabloid(raw, analyzed)`（纯函数，导出，返回 `{ tabloid, degradedFields }`，**不抛**）
   `parseTabloidJson` 保留为薄封装或按需保留导出（避免破坏已有 import）。
4. **Field guards** — 按 design.md 的补位表逐字段实现守卫；`translations` 复用现有空 drama 回落规则。
5. **Wire up** — `generateTabloid`：`safeParseTabloid` 返回 `tabloid === null` 时抛错进既有 catch；`llmError` 文案保持简短可操作。
6. **Exports** — `packages/core/src/index.ts` 导出新公开符号（`normalizeRawJson`、`safeParseTabloid` 及类型）。
7. **Env docs** — `.env.example` 加 `LLM_TIMEOUT_MS` 注释；README 环境变量表补一行。
8. **Tests** — `test/llm-resilience.test.ts`：
   - `normalizeRawJson`：围栏、前后废话、无 JSON 三种输入
   - `safeParseTabloid`：全字段正常 / 部分字段损坏 / 完全非 JSON
   - 超时：注入永不 resolve 的 `fetchImpl` + `timeoutMs: 50`，断言 `mode: "fallback"` 且 `llmError` 含超时语义
   - `fetch` 打桩断言 `signal` 已传入
9. **Typecheck / tests** — `npm test`、`npm run typecheck`。

## Validation

```bash
npm test
npm run typecheck -w @repo-gossip/core
npm run gossip -- vercel/next.js --offline   # 冒烟：offline 路径不受影响
```

## Risky files

- `packages/core/src/llm.ts` — 出报质量主路径，字段补位写错会静默劣化输出
- `packages/core/src/config.ts` — `envSchema` 改动影响 CLI / bot / api 三处 `loadEnv`

## Review gates

- [ ] `Tabloid` 类型形状未变（`format=json` 响应契约保持）
- [ ] `mode` 三态语义未变；`fallback` 必带 `llmError`
- [ ] 单测全部离线，无真实网络调用
- [ ] 日志/错误信息里没有 API key 或请求体

## Rollback points

- 步骤 2 之后：`git diff` 确认只有超时相关改动，可单独回退
- 步骤 3-5 之后：若字段补位行为异常，可只回退 `safeParseTabloid` 而保留超时改动

## Explicitly not doing

- 提示词调优、重试策略、流式输出、zod schema 校验
- 把 `degradedFields` 暴露进 `/api/gossip` 响应（先只做内部可观测）
