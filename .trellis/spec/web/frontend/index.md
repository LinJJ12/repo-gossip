# @repo-gossip/web — Frontend Guidelines

Vite + React 19 preview site for tabloid gossip. Brand-first dark editorial UI.

**Package path**: `apps/web`  
**Dev**: `npm run web` (port 5173; Vite middleware implements `/api/gossip`)

---

## Pre-Development Checklist

- [ ] Keep brand `repo/gossip` as the hero signal; form is the primary interaction
- [ ] Call `/api/gossip` for live data; do not reimplement analyzer/LLM in the browser
- [ ] Mirror core `Tabloid` / mode fields in `src/types.ts` when core shapes change
- [ ] Secrets stay server-side (Vite loads root `.env` only for the gossip middleware)

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Files and Vite plugin |
| [Components](./component-guidelines.md) | App / TabloidView split |
| [State](./state-management.md) | Local React state only |
| [Types](./type-safety.md) | Payload types |
| [Hooks](./hook-guidelines.md) | Minimal hooks usage |
| [Quality & Visual](./quality-guidelines.md) | CSS tokens, motion, a11y |

## Quality Check

- [ ] Sample tabloid still renders without API
- [ ] Mode banners cover `llm` / `offline` / `fallback`
- [ ] `npm run typecheck -w @repo-gossip/web`
