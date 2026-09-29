# Implement: content-quality-activity-signals

## Checklist (order)

1. **Types** — `packages/core/src/types.ts`: `PullStat` / `IssueStat` / `ReleaseStat`; extend `RepoSnapshot` + `AnalyzedGossip`.
2. **Fetch** — `packages/core/src/github.ts`: parallel list pulls/issues/releases with caps + soft-fail; fill new fields.
3. **Analyze** — `packages/core/src/analyzer.ts`: notablePulls / hotIssues / latestRelease; 1–2 new awards when evidence exists; keep analyzer pure.
4. **Narrative** — `packages/core/src/llm.ts`: enrich `buildFactSheet` + SYSTEM_PROMPT hint; improve `fallbackTabloid` / local drama lines for activity.
5. **Offline** — `packages/core/src/gossip.ts` `buildOfflineTabloid`: weave activity into existing fields.
6. **Format (light)** — `packages/core/src/format.ts`: optional header activity counts only; no new section titles.
7. **Exports** — `packages/core/src/index.ts` if new public types/helpers needed by tests.
8. **Tests** — `test/core.test.ts`: fixture snapshot with pulls/issues/releases → analyze awards/fields; offline/format asserts readable clues (`#12`, tag, etc.).
9. **Docs (minimal)** — README「小报里有什么」一行提到 PR/Issue/发版素材（若与现表述冲突再改）。

## Validation

```bash
npm test
npm run typecheck -w @repo-gossip/core
```

Optional smoke (needs token): `npm run gossip -- <owner/repo> --offline`

## Risky points

- GitHub issues API returns PRs as issues — **must filter** `pull_request`.
- Extra API calls → rate limit; keep caps low; soft-fail.
- Do not change LLM JSON key set.

## Before `task.py start`

- [x] prd / design / implement written
- [ ] Curate `implement.jsonl` + `check.jsonl` with real spec entries
- [ ] User approves final planning summary
