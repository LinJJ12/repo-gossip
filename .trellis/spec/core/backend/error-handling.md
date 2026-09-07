# Error Handling — core

## Throw vs degrade

| Situation | Behavior | Reference |
|-----------|----------|-----------|
| Unparseable repo string | **Throw** `Error` with usage hint | `parseRepoRef` |
| GitHub 403/429 rate limit | **Retry** then **Throw** enriched message (`GITHUB_TOKEN` hint) | `github-retry.ts` / `withGithubRetry` |
| GitHub commit detail fetch fails | **Degrade**: list payload + `statsIncomplete` → `warnings` | `github.ts` / `gossip.ts` |
| Missing LLM key / `--offline` | **Degrade**: offline tabloid, optional `llmError` | `gossip.ts` |
| LLM HTTP/parse failure | **Degrade**: `fallbackTabloid`, `mode: "fallback"`, log + `llmError` | `llm.ts` `generateTabloid` |
| BYOK `x-llm-base-url` metadata/SSRF | **Drop** header (`isAllowedLlmBaseUrl`) | `byok.ts` |
| CLI top-level failure | Print message to stderr, `process.exit(1)` | `cli.ts` |

## Zod env

`loadEnv` uses `envSchema.parse` — invalid types fail fast. Most secrets are optional at schema level; adapters decide what is required at runtime.

## Message style

- User-facing errors: short, actionable (`Cannot parse repo: …`, `LLM request failed 401: …` truncated).
- Prefer `err instanceof Error ? err.message : String(err)` at boundaries.

## Anti-patterns

- Swallowing LLM errors without setting `mode: "fallback"`
- Throwing from `analyzeSnapshot` for empty commit lists (empty → frozen temperature is valid)
- Returning 200 success payloads with empty `drama` after the blank-translation bug fix
