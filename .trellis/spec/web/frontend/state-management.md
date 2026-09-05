# State Management — web

## Pattern

Local `useState` in `App` only:

- `repo`, `days`, `useLlm`, `loading`, `error`
- `data: TabloidPayload | null` (starts as `SAMPLE_TABLOID`)
- `isSample` to distinguish sample vs live

No Context, Redux, or URL state libraries.

## Fetch flow

`generate(target)` → POST `/api/gossip` with `{ repo, offline: !useLlm, days }` → set `data` or `error`. Always clear loading in `finally`.

## Derived UI

- `MODE_LABEL` maps `GossipMode` to Chinese banners.
- Rate-limit errors get an extra hint about `GITHUB_TOKEN` / 看样报.

## Anti-patterns

- Storing secrets in React state
- Calling `runGossip` from the browser bundle instead of `/api/gossip`
- Synchronizing large analyzed snapshots into multiple duplicated state atoms
