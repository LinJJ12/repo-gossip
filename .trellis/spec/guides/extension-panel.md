# Extension Content Panel Guide

> When changing GitHub content-script panel (`apps/extension/content.js` + friends).

## Checklist

- [ ] Manifest loads `history-logic.js` **before** `content.js`
- [ ] Panel `×` **hides** (`is-hidden`), does not `remove()` DOM
- [ ] Header「最近」/「当前」toggle restores `lastReport` in memory
- [ ] Same-repo float click reopens `chrome.storage.local` cache;「重新出报」fetches
- [ ] Render structured sections (mirror `app.js` / `TabloidView`), not a wall of `<pre>`
- [ ] History writes go through background `HISTORY_UPSERT` (uses `RepoGossipHistoryLogic` + write lock)
- [ ] Bump `manifest.json` version on user-visible extension changes

## Storage contract

| Key | Shape | Rules |
|-----|--------|--------|
| `repoGossipHistory` | `Array<{ repo, savedAt, mode?, epicTitle?, plain, data }>` | MRU first; max **20**; `repo` lowercased `owner/repo` (URL / snapshot.fullName via `resolveRepoKey`); only successful responses |
| `repoGossipBtnPos` | `{ left, top }` | Existing float position |

Shared by **sidebar + toolbar popup + full page** (`chrome.storage.local`). Web preview uses the same key name in **`localStorage`** only — not synced with the extension.

`data` is **slimmed** gossip payload (structured tabloid fields + author-only commits). Do not store full commit message bodies.

Background service worker loads `history-logic.js` via `importScripts` (classic SW, not `type: module`) and owns the serialized upsert path.

## Popup / full page

- Load `history-logic.js` **before** `app.js`
- chips 旁「最近」展开列表；点选复开缓存（无 `GOSSIP_FETCH`）
- Successful generate sends `HISTORY_UPSERT` (do not RMW `chrome.storage.local` directly)

## UI / fetch races

- Use a monotonic `gossipFetchSeq`; bump on hide / 最近 / cache reopen so stale `GOSSIP_FETCH` cannot overwrite UI
- Still **upsert** successful payloads even when UI was superseded
- Serialize history RMW in **background** (`HISTORY_UPSERT` + write chain + quota trim retry) — not per-page locks
## Common mistakes

| Wrong | Correct |
|-------|---------|
| `×` → `el.remove()` | `×` → `classList.add("is-hidden")` |
| Dump `message.plain` in `<pre>` | Sectioned HTML like extension `app.js` `renderTabloid` |
| Dedupe history with exact URL casing | `normalizeRepoKey` / `resolveRepoKey` |
| Popup/content direct history RMW | `chrome.runtime.sendMessage({ type: "HISTORY_UPSERT", ... })` |
| Put untrusted `temperature.level` in CSS class | `sanitizeTempLevel` whitelist |
| Skip ensure while `ensuring` on SPA nav | `scheduleEnsure()` retry |
