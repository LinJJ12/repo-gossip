# Pipeline & Modes — core

## Primary entry

`runGossip(options)` in `packages/core/src/gossip.ts`:

1. `parseRepoRef(options.repo)`
2. `fetchRepoSnapshot` via Octokit (`sinceDays` default 14, max ~40 commits)
3. `analyzeSnapshot` (pure)
4. Narrative:
   - **offline** if `options.offline` or missing `LLM_API_KEY` → `buildOfflineTabloid`
   - else `generateTabloid` → mode `llm` or `fallback` on failure
5. `formatTabloid` → `{ plain, markdown }`

Return shape:

```ts
{ tabloid, message, mode: "llm" | "offline" | "fallback", llmError?: string }
```

## Mode semantics (do not invent new names)

| Mode | When |
|------|------|
| `offline` | Explicit offline flag, or no API key |
| `llm` | LLM returned parseable JSON |
| `fallback` | LLM threw; local templates used; `llmError` set |

Adapters (CLI, Discord, Telegram, Feishu, `/api/gossip`, web) should surface `mode` / `llmError` to users when not `llm`.

## LLM contract

- System prompt requires **English JSON keys**: `epicTitle`, `awardsNarrative`, `temperatureLine`, `translations`, `easterEggLines`, `closing`.
- Human-readable string values must be **Chinese**.
- `translations[]` items: `{ original, drama, author }` — never leave `drama` empty for display.
- `normalizeTranslations` accepts English **and** Chinese field aliases (`原文`/`翻译`/`作者`, etc.). Empty/blank drama → refill from `dramatizeLocally`.
- Chat Completions: try `response_format: json_object` first; retry without if provider rejects it.

## Local templates

`dramatizeLocally` / `buildOfflineTabloid` / `fallbackTabloid` are the safety net. Prefer improving these over failing the whole request when LLM is flaky.

## Anti-patterns

- Calling Octokit or `fetch` from `analyzer.ts`
- Skipping fallback and returning empty translations
- Putting Discord/Telegram/Feishu SDK imports inside core
- Changing mode string union without updating web `types.ts` and UI labels
