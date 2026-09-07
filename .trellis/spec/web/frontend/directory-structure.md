# Directory Structure — web

```
apps/web/
├── index.html
├── vite.config.ts          # React plugin + gossipApiPlugin + core alias
└── src/
    ├── main.tsx            # StrictMode mount
    ├── App.tsx             # Hero form, fetch, 「最近」, mode/error UX
    ├── history.ts          # localStorage history (normalize / slim / upsert)
    ├── TabloidView.tsx     # Presentational tabloid article
    ├── types.ts            # TabloidPayload / GossipMode (frontend mirror)
    ├── sample.ts           # Offline sample payload for first paint
    └── styles.css          # CSS variables, layout, motion
```

## Data path

- **Dev**: `vite.config.ts` `gossipApiPlugin` handles `/api/gossip`, SSR-loads `packages/core/src/gossip.ts`, returns `{ tabloid, message, mode, llmError }`.
- **Prod (Vercel)**: same path hits `api/gossip.ts` (may require `WEBHOOK_SECRET` — web client currently posts without secret; local Vite path does not enforce webhook auth).

## Alias

`@repo-gossip/core` → `packages/core/src/index.ts` for any direct imports; primary UI path still uses HTTP JSON so the browser never needs Octokit.

## Anti-patterns

- Adding React Router / global store for this single-page preview
- Bundling GitHub tokens or LLM keys into client code
- Putting platform bots under `apps/web`
