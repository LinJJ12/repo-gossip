import type { GossipMode, TabloidPayload, TemperatureLevel } from "./types";

export const HISTORY_KEY = "repoGossipHistory";
export const DEFAULT_HISTORY_LIMIT = 20;

const TEMP_LEVELS = new Set<TemperatureLevel>([
  "blazing",
  "warm",
  "cool",
  "frozen",
]);
const REPO_KEY_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const GITHUB_URL =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i;

export type HistoryEntry = {
  repo: string;
  savedAt: number;
  mode?: string;
  epicTitle?: string;
  plain: string;
  data: TabloidPayload;
};

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizeRepoKey(repo: unknown): string | null {
  if (typeof repo !== "string") return null;
  const trimmed = repo.trim();
  if (!REPO_KEY_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function sanitizeTempLevel(level: unknown): TemperatureLevel {
  const s = String(level || "").toLowerCase();
  return TEMP_LEVELS.has(s as TemperatureLevel)
    ? (s as TemperatureLevel)
    : "cool";
}

/** Prefer owner/repo; else GitHub URL; else snapshot.fullName. */
export function resolveRepoKey(
  input: unknown,
  data?: { tabloid?: { analyzed?: { snapshot?: { fullName?: string } } } } | null,
): string | null {
  const direct = normalizeRepoKey(input);
  if (direct) return direct;
  if (typeof input === "string") {
    const m = input.trim().match(GITHUB_URL);
    if (m) {
      const fromUrl = normalizeRepoKey(
        `${m[1]}/${m[2]!.replace(/\.git$/i, "")}`,
      );
      if (fromUrl) return fromUrl;
    }
  }
  return normalizeRepoKey(data?.tabloid?.analyzed?.snapshot?.fullName);
}

export function normalizeHistoryList(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const byRepo = new Map<string, HistoryEntry>();
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const row = e as Partial<HistoryEntry>;
    const key = normalizeRepoKey(row.repo);
    if (!key || !row.data || typeof row.data !== "object") continue;
    // Re-slim so corrupt / partial payloads cannot crash TabloidView.
    const slim = slimGossipData(row.data);
    if (!slim?.tabloid?.analyzed) continue;
    const savedAt = Number(row.savedAt) || 0;
    const prev = byRepo.get(key);
    if (!prev || savedAt >= (Number(prev.savedAt) || 0)) {
      byRepo.set(key, {
        repo: key,
        savedAt,
        mode: slim.mode != null ? String(slim.mode) : undefined,
        epicTitle: slim.tabloid.epicTitle
          ? String(slim.tabloid.epicTitle)
          : undefined,
        plain: slim.message.plain,
        data: slim,
      });
    }
  }
  return [...byRepo.values()].sort(
    (a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0),
  );
}

export function findHistoryEntry(
  list: HistoryEntry[],
  repo: unknown,
): HistoryEntry | null {
  const key = normalizeRepoKey(repo) || resolveRepoKey(repo);
  if (!key) return null;
  return list.find((e) => e && normalizeRepoKey(e.repo) === key) || null;
}

export function slimGossipData(data: unknown): TabloidPayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as TabloidPayload & {
    warnings?: unknown;
    tabloid?: {
      analyzed?: {
        snapshot?: { commitCount?: number };
      };
    };
  };
  const analyzed = d.tabloid?.analyzed;
  if (!analyzed || typeof analyzed !== "object") return null;

  const snap = analyzed.snapshot;
  const rawCommits = Array.isArray(snap?.commits) ? snap.commits : [];
  const commits = rawCommits.map((c) => ({
    authorLogin: (c as { authorLogin?: string })?.authorLogin,
    author: String((c as { author?: string })?.author ?? ""),
  }));
  const warnings = Array.isArray(d.warnings)
    ? d.warnings.map((w) => String(w)).slice(0, 30)
    : undefined;
  const temp = analyzed.temperature;
  const commitCount =
    typeof snap?.commitCount === "number" && Number.isFinite(snap.commitCount)
      ? snap.commitCount
      : rawCommits.length;

  const plain =
    typeof d.message?.plain === "string"
      ? d.message.plain
      : JSON.stringify(data, null, 2);

  const starsRaw = Number(snap?.stars);
  const stars = Number.isFinite(starsRaw) ? starsRaw : 0;

  return {
    mode: d.mode,
    llmError: d.llmError,
    warnings,
    message: {
      plain,
      // TabloidPayload requires markdown; history UI does not render it.
      markdown:
        typeof d.message?.markdown === "string" ? d.message.markdown : plain,
    },
    tabloid: {
      epicTitle: String(d.tabloid?.epicTitle ?? ""),
      temperatureLine: String(d.tabloid?.temperatureLine ?? ""),
      awardsNarrative: Array.isArray(d.tabloid?.awardsNarrative)
        ? d.tabloid.awardsNarrative.map((x) => String(x))
        : [],
      translations: Array.isArray(d.tabloid?.translations)
        ? d.tabloid.translations
        : [],
      easterEggLines: Array.isArray(d.tabloid?.easterEggLines)
        ? d.tabloid.easterEggLines.map((x) => String(x))
        : [],
      closing: String(d.tabloid?.closing ?? ""),
      analyzed: {
        awards: Array.isArray(analyzed.awards) ? analyzed.awards : [],
        topAuthors: Array.isArray(analyzed.topAuthors)
          ? analyzed.topAuthors
          : [],
        easterEggs: Array.isArray(analyzed.easterEggs)
          ? analyzed.easterEggs
          : [],
        temperature: {
          level: sanitizeTempLevel(temp?.level),
          emoji: String(temp?.emoji ?? ""),
          label: String(temp?.label ?? ""),
          commitsLast3Days: Number(temp?.commitsLast3Days) || 0,
          daysSinceLastCommit:
            temp?.daysSinceLastCommit == null
              ? null
              : Number(temp.daysSinceLastCommit),
        },
        snapshot: {
          fullName: String(snap?.fullName ?? ""),
          stars,
          language: snap?.language ?? null,
          description: snap?.description ?? null,
          commits,
          // Kept for parity with extension slim; TabloidView uses commits.length.
          commitCount,
        } as TabloidPayload["tabloid"]["analyzed"]["snapshot"],
      },
    },
  };
}

export function buildHistoryEntry(
  repo: string,
  data: unknown,
  savedAt = Date.now(),
): HistoryEntry | null {
  const key = resolveRepoKey(repo, data as TabloidPayload);
  const slim = slimGossipData(data);
  if (!key || !slim) return null;
  return {
    repo: key,
    savedAt,
    mode: slim.mode != null ? String(slim.mode) : undefined,
    epicTitle: slim.tabloid?.epicTitle
      ? String(slim.tabloid.epicTitle)
      : undefined,
    plain: slim.message.plain,
    data: slim,
  };
}

export function upsertHistoryList(
  list: HistoryEntry[],
  entry: HistoryEntry | null | undefined,
  limit = DEFAULT_HISTORY_LIMIT,
): HistoryEntry[] {
  const key = entry ? normalizeRepoKey(entry.repo) : null;
  if (!key || !entry?.data) {
    return normalizeHistoryList(list);
  }
  const base = normalizeHistoryList(list);
  const next = base.filter((e) => normalizeRepoKey(e.repo) !== key);
  next.unshift({ ...entry, repo: key });
  const cap = Math.max(1, Number(limit) || DEFAULT_HISTORY_LIMIT);
  return next.slice(0, cap);
}

export function formatSavedAt(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function loadHistoryFromStorage(
  storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): HistoryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return normalizeHistoryList(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveHistoryToStorage(
  list: HistoryEntry[],
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(normalizeHistoryList(list)));
  } catch {
    // quota / private mode — ignore
  }
}

export function upsertHistoryInStorage(
  repo: string,
  data: unknown,
  storage: Pick<Storage, "getItem" | "setItem"> | null = getLocalStorage(),
): HistoryEntry[] {
  if (!storage) return [];
  const entry = buildHistoryEntry(repo, data);
  if (!entry) return loadHistoryFromStorage(storage);
  const next = upsertHistoryList(loadHistoryFromStorage(storage), entry);
  saveHistoryToStorage(next, storage);
  return next;
}

export type { GossipMode };
