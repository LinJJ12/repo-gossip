# Design: LLM 调用韧性与输出校验

## 影响范围

只动 `packages/core/src/llm.ts` 与 `packages/core/src/config.ts`。`gossip.ts` 的调用方式不变，`api/` `apps/` 无感。

## 现状形状

```
generateTabloid(analyzed, llm)
  ├─ buildFactSheet(analyzed)                      纯函数
  ├─ chatCompletion(llm, messages)                 fetch，无 signal
  │    └─ attempt(true) 失败且错误信息含 response_format → attempt(false)
  └─ parseTabloidJson(raw, analyzed)               一次 JSON.parse
       失败 → 整个 generateTabloid catch → fallbackTabloid(analyzed)
```

问题的根源是 **`parseTabloidJson` 抛错会穿透到最外层 catch**，而外层 catch 只有「全部作废」一种处理。

## 目标形状

```
generateTabloid(analyzed, llm, opts?: { timeoutMs?, fetchImpl? })
  ├─ chatCompletion(..., { signal: AbortSignal.timeout(timeoutMs) })
  └─ safeParseTabloid(raw, analyzed) -> { tabloid, degradedFields: string[] }
       ├─ normalizeRawJson(raw)        剥围栏 + 截首尾花括号 + trim（纯函数，导出）
       ├─ try/catch JSON.parse         失败 → 返回 null（不抛）
       └─ 逐字段守卫 + 本地补位（纯函数，导出）
```

关键变化：`parseTabloidJson` 不再抛错给外层，而是**返回一个结果对象**。外层只在「拿不到任何可用字段」时才 fallback。

## 契约设计

### 1. `chatCompletion`

```ts
export type ChatFetch = typeof fetch;

async function chatCompletion(
  llm: LlmConfig,
  messages: ChatMessage[],
  options?: { timeoutMs?: number; fetchImpl?: ChatFetch },
): Promise<string>
```

- `timeoutMs` 默认取 `loadEnv().LLM_TIMEOUT_MS ?? 20_000`。
- `signal: AbortSignal.timeout(timeoutMs)`；`AbortSignal.timeout` 在 Node 18+ 与浏览器均可用。
- `fetchImpl` 仅供测试注入；生产走全局 `fetch`。
- 超时会被 `fetch` 抛成 `AbortError`（或 `DOMException`），需归一化成普通 `Error`，message 形如 `LLM request timed out after 20000ms`。

> 注意：`AbortSignal.timeout` 创建的是「从现在起 N 毫秒」的一次性信号，两次 attempt 各自创建自己的 signal，符合预期。

### 2. 解析层（导出为纯函数）

```ts
export type ParsedTabloid = {
  tabloid: Tabloid | null;          // null = 无任何可用字段
  degradedFields: string[];         // 哪些字段用了本地补位
};

export function normalizeRawJson(raw: string): string;
export function safeParseTabloid(raw: string, analyzed: AnalyzedGossip): ParsedTabloid;
```

`normalizeRawJson` 只做三件事，按顺序：
1. `trim()` 并去掉 BOM；
2. 若匹配 `/```(?:json)?\s*([\s\S]*?)```/i` 取第一组，否则用原文；
3. 取首个 `{` 到最后一个 `}` 之间的子串；找不到则原样返回。

> 现有代码已隐含第 2、3 步，本任务只是把它抽出来并加 try/catch 边界。

### 3. 字段补位规则

| 字段 | 有效条件 | 补位值 |
|------|---------|--------|
| `epicTitle` | 非空字符串 | `fallbackTitle(analyzed)` |
| `temperatureLine` | 非空字符串 | `${emoji}「${label}」`（与今日 fallback 一致） |
| `closing` | 非空字符串 | `本期八卦到此结束。` |
| `awardsNarrative` | 数组且每项可 `String()` | `analyzed.awards` 渲染的本地行 |
| `easterEggLines` | 数组且每项可 `String()` | `analyzed.easterEggs` 渲染的本地行 |
| `translations` | `normalizeTranslations` 后至少一项 `drama` 非空 | `notableCommits.slice(0,5)` + `dramatizeLocally` |

「有效字段数 ≥ 1」→ 返回 `tabloid`；「0」→ 返回 `null`，外层 fallback。

### 4. `generateTabloid` 的收口

```ts
try {
  const raw = await chatCompletion(...);
  const { tabloid, degradedFields } = safeParseTabloid(raw, analyzed);
  if (!tabloid) throw new Error("LLM returned no usable fields");
  return { tabloid, mode: "llm", degradedFields };
} catch (err) {
  // 与今日一致：fallbackTabloid + mode:"fallback" + llmError
}
```

`degradedFields` 是**新增的可选返回信息**，不进 `Tabloid` 类型（保持 `Tabloid` 形状不变），避免破坏 `/api/gossip` 的 `format=json` 响应契约。

## 兼容性

- `Tabloid` 类型、`mode` 三态、`llmError` 语义**全部不变**。
- `/api/gossip` 响应体不变（`format=json` 仍返回 `tabloid`）。
- Web / 扩展对 `mode === "fallback"` 的黄色提示逻辑不变。
- 未设置 `LLM_TIMEOUT_MS` 时，唯一行为变化是「请求最多挂 20s 而不是无限等」——这是期望的修正。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| `AbortSignal.timeout` 在旧运行时不存在 | Node ≥ 18（package.json engines 已声明），加一个 `typeof AbortSignal.timeout === "function"` 的守卫，缺失时退化为无超时（保持今日行为） |
| 字段级补位掩盖了 LLM 质量问题 | `degradedFields` 可观测；后续可决定是否暴露到 warnings |
| 单测里超时用例拖慢测试 | 通过 `fetchImpl` + 注入的 `timeoutMs`（如 50ms）测试，不依赖真实 20s |

回滚：改动集中在 `llm.ts`，`git revert` 即可；无数据迁移、无存储变更。

## 不做的事

- 不改 `SYSTEM_PROMPT`
- 不改 `buildFactSheet` 的字段集
- 不引入流式/并发
