# Extension Content Panel Guide

> When changing GitHub content-script panel (`apps/extension/content.js` + friends).

## Checklist

- [ ] Manifest loads `history-logic.js` **before** `content.js`
- [ ] Panel `×` **hides** (`is-hidden`), does not `remove()` DOM
- [ ] Header「最近」/「当前」toggle restores `lastReport` in memory
- [ ] Same-repo float click reopens `chrome.storage.local` cache;「重新出报」fetches
- [ ] Render structured sections (mirror `app.js` / `TabloidView`), not a wall of `<pre>`
- [ ] History writes go through `RepoGossipHistoryLogic` (normalize / slim / upsert)
- [ ] Bump `manifest.json` version on user-visible extension changes

## Storage contract

| Key | Shape | Rules |
|-----|--------|--------|
| `repoGossipHistory` | `Array<{ repo, savedAt, mode?, epicTitle?, plain, data }>` | MRU first; max **20**; `repo` lowercased `owner/repo`; only successful responses |
| `repoGossipBtnPos` | `{ left, top }` | Existing float position |

`data` is **slimmed** gossip payload (structured tabloid fields + author-only commits). Do not store full commit message bodies.

## UI / fetch races

- Use a monotonic `gossipFetchSeq`; bump on hide / 最近 / cache reopen so stale `GOSSIP_FETCH` cannot overwrite UI
- Still **upsert** successful payloads even when UI was superseded
- Serialize history RMW with a promise chain (`withHistoryLock`)

## Common mistakes

| Wrong | Correct |
|-------|---------|
| `×` → `el.remove()` | `×` → `classList.add("is-hidden")` |
| Dump `message.plain` in `<pre>` | Sectioned HTML like extension `app.js` `renderTabloid` |
| Dedupe history with exact URL casing | `normalizeRepoKey` (lowercase) |
| Put untrusted `temperature.level` in CSS class | `sanitizeTempLevel` whitelist |
| Skip ensure while `ensuring` on SPA nav | `scheduleEnsure()` retry |
