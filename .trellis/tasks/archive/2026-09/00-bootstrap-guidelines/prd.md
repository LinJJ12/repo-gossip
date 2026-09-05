# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

---

## Status

- [x] Fill guidelines for @repo-gossip/core
- [x] Fill guidelines for @repo-gossip/bot
- [x] Fill guidelines for @repo-gossip/web
- [x] Add code examples

## Spec decisions (from codebase)

- **core**: backend-only. Removed unused `frontend/` template and `database-guidelines.md` (no DB). Added `pipeline.md` for gossip modes / LLM fallback.
- **bot**: backend-only (platform adapters). Removed unused `frontend/` and database templates. Documented root `api/` thin Vercel adapters alongside `apps/bot`. Added `platforms.md`.
- **web**: frontend-only Vite/React preview; specs cite `App.tsx`, `TabloidView.tsx`, `styles.css`, Vite gossip middleware.
- No prior CLAUDE.md / .cursorrules — specs written from source + `docs/architecture.md` + tests.

## Spec files populated

### Package: @repo-gossip/core (`spec/core/backend/`)

- `index.md`, `directory-structure.md`, `pipeline.md`, `error-handling.md`, `logging-guidelines.md`, `quality-guidelines.md`

### Package: @repo-gossip/bot (`spec/bot/backend/`)

- `index.md`, `directory-structure.md`, `platforms.md`, `error-handling.md`, `logging-guidelines.md`, `quality-guidelines.md`

### Package: @repo-gossip/web (`spec/web/frontend/`)

- `index.md`, `directory-structure.md`, `component-guidelines.md`, `state-management.md`, `type-safety.md`, `hook-guidelines.md`, `quality-guidelines.md`

### Thinking guides

Left `spec/guides/` as Trellis defaults (still applicable).

---

## Completion

Developer should confirm the checklist above, then:

```bash
python ./.trellis/scripts/task.py finish
python ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```
