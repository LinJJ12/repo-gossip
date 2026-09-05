# Quality Guidelines — core

## Language & toolchain

- TypeScript ESM (`"type": "module"`), Node ≥ 18
- `zod` for env; `@octokit/rest` for GitHub; native `fetch` for LLM
- Typecheck: `npm run typecheck -w @repo-gossip/core`
- Tests: `npm test` → `tsx --test test/**/*.test.ts`

## Types

- Prefer explicit `type` aliases in `types.ts` over interfaces for domain data
- Avoid `as` casts when parsing LLM JSON; coerce with `String(...)`, `Array.isArray`, and helpers like `normalizeTranslations`
- Non-null assertions (`!`) appear after regex matches / array access — keep them next to validated control flow

## Testing patterns (trusted examples)

File: `test/core.test.ts`

- `node:assert/strict` + `describe`/`it` from `node:test`
- Unit-test pure functions (`parseRepoRef`, `analyzeSnapshot`, `dramatizeLocally`, `normalizeTranslations`) with small fixtures
- Assert Chinese output / punctuation regressions (e.g. awards lines must not match `/\?\w/`)

## Forbidden / discouraged

- Adding a database or ORM to core (none exists; gossip is request-scoped)
- Requiring LLM for tests — offline/local templates must remain testable
- Deep-importing core internals from apps when a public export would do
- Putting secrets in source or frontend bundles

## Env loading

CLI loads **repo root** `.env` via path relative to `cli.ts` (`../../../.env`). Same pattern in `apps/bot` and Vite plugin — keep a single root `.env`, not per-package copies.
