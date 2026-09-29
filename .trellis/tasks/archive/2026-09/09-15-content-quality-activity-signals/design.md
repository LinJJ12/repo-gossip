# Design: content-quality-activity-signals

## Architecture & boundaries

- **Owner**: `packages/core` only.
- **Fetch** (`github.ts`): Octokit only; extend `RepoSnapshot` with activity arrays + incomplete flags.
- **Analyze** (`analyzer.ts`): pure; no Octokit; derive narrative fields + optional new awards.
- **Narrative** (`llm.ts` + `gossip.ts` offline): enrich `buildFactSheet` / offline templates; **same Tabloid keys**.
- **Format** (`format.ts`): optional header metrics only; **no new section headings**.
- **Adapters**: unchanged callers of `runGossip`.

## Data flow

```
fetchRepoSnapshot
  → commits (existing) + pulls[] + issues[] + releases[]
analyzeSnapshot
  → notablePulls / hotIssues / latestRelease (+ awards)
buildFactSheet | buildOfflineTabloid
  → existing Tabloid fields (weave activity into awards/temperature/translations/closing)
formatTabloid
  → same sections; header may mention activity counts
```

## Contracts

### New snapshot fields (sketch)

```ts
type PullStat = {
  number: number;
  title: string;
  author: string;
  state: string;
  merged: boolean;
  updatedAt: string;
};

type IssueStat = {
  number: number;
  title: string;
  author: string;
  state: string;
  labels: string[];
  updatedAt: string;
};

type ReleaseStat = {
  tag: string;
  name: string;
  author?: string;
  publishedAt: string;
  prerelease: boolean;
};

// on RepoSnapshot:
pulls: PullStat[];
issues: IssueStat[];
releases: ReleaseStat[];
activityIncomplete?: boolean; // any activity fetch failed
```

### Caps (rate-limit friendly)

| Source | Cap | Window |
|--------|-----|--------|
| pulls | ~15 | client-filter by `updated_at` / `merged_at` ≥ since |
| issues | ~15 | API `since` + exclude items with `pull_request` |
| releases | ~5 | list then filter `published_at` ≥ since (else keep latest 1 for context if any) |

Fetch activity in parallel with commit detailing where safe; each list wrapped in try/catch → empty array + `activityIncomplete`.

### AnalyzedGossip extensions

- `notablePulls`: prefer merged, else recently updated; top ~5
- `hotIssues`: open preferred, else recently updated; top ~5
- `latestRelease`: newest in window or newest overall if none in window
- Awards (examples, 0–2 when evidence exists): e.g. merge-heavy contributor, ship-it on fresh release

Temperature stays **commit-primary**; do not redefine levels solely from PR/issue counts in MVP.

### LLM / offline

- SYSTEM_PROMPT: mention that facts may include PRs/issues/releases; still **exact same JSON keys**; `translations` remain commit-message oriented (PR/issue titles may appear in awardsNarrative / temperatureLine / closing / easterEggLines as appropriate).
- Offline: template lines citing `#N title` / `tag` when present.
- Export `buildFactSheet` only if tests need it; otherwise assert via offline output strings.

## Compatibility

- No new required `runGossip` options.
- Gossip cache keys: unchanged unless new options appear (they do not).
- History slim types: ignore new analyzed fields if unknown; no web/extension change required for MVP.

## Trade-offs

| Choice | Why |
|--------|-----|
| Weave vs new sections | User chose A; fastest quality win |
| Soft-fail activity fetch | Matches commit-detail degrade pattern |
| Keep translations = commits | Avoid breaking LLM contract / normalizeTranslations |
| No out-of-window release fallback | Avoids false `ship-it` /「上线夜」on dormant repos |
| `merge-machine` only when ≥2 merges | Single merge is still woven via notablePulls |

## Rollback

Revert core type + fetch + analyzer + llm/offline + tests; adapters untouched.
