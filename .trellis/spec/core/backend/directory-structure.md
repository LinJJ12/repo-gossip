# Directory Structure — core

## Layout

```
packages/core/src/
├── index.ts      # Public API surface (re-exports only)
├── types.ts      # Domain types: RepoRef, RepoSnapshot, Tabloid, …
├── config.ts     # parseRepoRef, zod envSchema, loadEnv
├── github.ts     # Octokit client + fetchRepoSnapshot
├── analyzer.ts   # Pure analysis: temperature, awards, easter eggs
├── llm.ts        # Chat Completions + local dramatize / normalizeTranslations
├── format.ts     # PlatformMessage + Discord embed + Feishu card
├── gossip.ts     # Orchestrator: runGossip, buildOfflineTabloid
└── cli.ts        # CLI bin; loads repo-root .env
```

## Ownership rules

| Module | Owns | Must not |
|--------|------|----------|
| `types.ts` | Shared domain shapes | I/O, env |
| `config.ts` | Repo parsing + env schema | Network |
| `github.ts` | GitHub API + concurrency pool | Tabloid narrative |
| `analyzer.ts` | Deterministic scoring | LLM / fetch |
| `llm.ts` | Prompt, parse, local rewrite | Octokit |
| `format.ts` | Markdown/plain + platform payloads | Fetch |
| `gossip.ts` | End-to-end orchestration | Platform SDK (discord.js etc.) |
| `cli.ts` | argv + dotenv + print | Business rules beyond flags |

## Import / export conventions

- ESM with `.js` extensions in relative imports (`./gossip.js`) even though sources are `.ts`.
- Consumers import from `@repo-gossip/core`, not deep paths into `src/` (except Vite SSR and Vercel api which may load modules for bundling).
- Add new public APIs to `index.ts` when bots/web/api need them (see `normalizeTranslations` export after translation blank-fix).

## Related non-package code

- Root `api/` and `apps/*` are **adapters**; they call core, they do not reimplement analysis or LLM.
- Root `test/` covers core units with `node:test` + `tsx`.
