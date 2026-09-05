# @repo-gossip/core — Backend Guidelines

Gossip engine: GitHub fetch → analyze → LLM/offline → tabloid format.

**Package path**: `packages/core`  
**Public entry**: `@repo-gossip/core` → `packages/core/src/index.ts`  
**Tests**: root `test/core.test.ts` (`npm test`)

---

## Pre-Development Checklist

- [ ] Keep business logic in `packages/core`; adapters (bot/api/web) only call exports
- [ ] Prefer extending `runGossip` / analyzer / LLM fallback over duplicating pipelines
- [ ] Human-facing tabloid copy stays Chinese; JSON keys for LLM stay English
- [ ] Secrets stay in root `.env` / host env — never hardcode tokens

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Modules and ownership |
| [Pipeline & Modes](./pipeline.md) | `runGossip` modes, offline/fallback |
| [Error Handling](./error-handling.md) | Throw vs degrade |
| [Logging](./logging-guidelines.md) | stderr vs stdout |
| [Quality](./quality-guidelines.md) | Types, exports, tests |

## Quality Check

- [ ] New public symbols exported from `index.ts`
- [ ] LLM path still falls back via `dramatizeLocally` / `normalizeTranslations`
- [ ] `npm run typecheck -w @repo-gossip/core` and `npm test` pass
