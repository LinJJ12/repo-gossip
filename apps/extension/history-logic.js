/**
 * Pure helpers for extension panel history (classic script + Node vm tests).
 * Loaded before content.js via manifest content_scripts order.
 */
(function (root) {
  const DEFAULT_LIMIT = 20;
  const TEMP_LEVELS = new Set(["blazing", "warm", "cool", "frozen"]);
  const REPO_KEY_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
  const GITHUB_URL =
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i;

  /**
   * @param {unknown} repo
   * @returns {string | null}
   */
  function normalizeRepoKey(repo) {
    if (typeof repo !== "string") return null;
    const trimmed = repo.trim();
    if (!REPO_KEY_RE.test(trimmed)) return null;
    return trimmed.toLowerCase();
  }

  /**
   * Prefer owner/repo; else GitHub URL; else snapshot.fullName.
   * @param {unknown} input
   * @param {any} [data]
   * @returns {string | null}
   */
  function resolveRepoKey(input, data) {
    const direct = normalizeRepoKey(input);
    if (direct) return direct;
    if (typeof input === "string") {
      const m = input.trim().match(GITHUB_URL);
      if (m) {
        const fromUrl = normalizeRepoKey(
          `${m[1]}/${String(m[2]).replace(/\.git$/i, "")}`,
        );
        if (fromUrl) return fromUrl;
      }
    }
    return normalizeRepoKey(data?.tabloid?.analyzed?.snapshot?.fullName);
  }

  /**
   * @param {unknown} level
   * @returns {"blazing" | "warm" | "cool" | "frozen"}
   */
  function sanitizeTempLevel(level) {
    const s = String(level || "").toLowerCase();
    return TEMP_LEVELS.has(s)
      ? /** @type {"blazing" | "warm" | "cool" | "frozen"} */ (s)
      : "cool";
  }

  /**
   * @param {unknown} raw
   * @returns {any[]}
   */
  function normalizeHistoryList(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {Map<string, any>} */
    const byRepo = new Map();
    for (const e of raw) {
      if (!e || typeof e !== "object") continue;
      const key = normalizeRepoKey(e.repo);
      if (!key || !e.data || typeof e.data !== "object") continue;
      const prev = byRepo.get(key);
      const savedAt = Number(e.savedAt) || 0;
      if (!prev || savedAt >= (Number(prev.savedAt) || 0)) {
        byRepo.set(key, { ...e, repo: key });
      }
    }
    return [...byRepo.values()].sort(
      (a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0),
    );
  }

  /**
   * @param {any[]} list
   * @param {string} repo
   * @returns {any | null}
   */
  function findHistoryEntry(list, repo) {
    const key = normalizeRepoKey(repo) || resolveRepoKey(repo);
    if (!key) return null;
    return list.find((e) => e && normalizeRepoKey(e.repo) === key) || null;
  }

  /**
   * Keep fields needed for structured panel render + linkify; drop bulky commit bodies.
   * @param {any} data
   * @returns {object | null}
   */
  function slimGossipData(data) {
    if (!data || typeof data !== "object") return null;
    const analyzed = data.tabloid?.analyzed;
    const rawCommits = Array.isArray(analyzed?.snapshot?.commits)
      ? analyzed.snapshot.commits
      : [];
    const commits = rawCommits.map((/** @type {any} */ c) => ({
      authorLogin: c?.authorLogin,
      author: c?.author,
    }));
    const warnings = Array.isArray(data.warnings)
      ? data.warnings.map((w) => String(w)).slice(0, 30)
      : undefined;
    const temp = analyzed?.temperature;
    const commitCount =
      typeof analyzed?.snapshot?.commitCount === "number" &&
      Number.isFinite(analyzed.snapshot.commitCount)
        ? analyzed.snapshot.commitCount
        : rawCommits.length;

    return {
      mode: data.mode,
      llmError: data.llmError,
      warnings,
      message: {
        plain:
          typeof data.message?.plain === "string"
            ? data.message.plain
            : JSON.stringify(data, null, 2),
      },
      tabloid: {
        epicTitle: data.tabloid?.epicTitle,
        temperatureLine: data.tabloid?.temperatureLine,
        awardsNarrative: Array.isArray(data.tabloid?.awardsNarrative)
          ? data.tabloid.awardsNarrative
          : [],
        translations: Array.isArray(data.tabloid?.translations)
          ? data.tabloid.translations
          : [],
        easterEggLines: Array.isArray(data.tabloid?.easterEggLines)
          ? data.tabloid.easterEggLines
          : [],
        closing: data.tabloid?.closing,
        analyzed: analyzed
          ? {
              awards: analyzed.awards || [],
              topAuthors: analyzed.topAuthors || [],
              easterEggs: analyzed.easterEggs || [],
              temperature: temp
                ? {
                    level: sanitizeTempLevel(temp.level),
                    emoji: temp.emoji,
                    label: temp.label,
                    commitsLast3Days: temp.commitsLast3Days,
                  }
                : undefined,
              snapshot: {
                fullName: analyzed.snapshot?.fullName,
                stars: analyzed.snapshot?.stars,
                language: analyzed.snapshot?.language,
                description: analyzed.snapshot?.description,
                commitCount,
                commits,
              },
            }
          : undefined,
      },
    };
  }

  /**
   * @param {string} repo
   * @param {any} data
   * @param {number} [savedAt]
   */
  function buildHistoryEntry(repo, data, savedAt = Date.now()) {
    const key = resolveRepoKey(repo, data);
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

  /**
   * @param {any[]} list
   * @param {any} entry
   * @param {number} [limit]
   * @returns {any[]}
   */
  function upsertHistoryList(list, entry, limit = DEFAULT_LIMIT) {
    const key = entry ? normalizeRepoKey(entry.repo) : null;
    if (!key || !entry?.data) {
      return normalizeHistoryList(list);
    }
    const base = normalizeHistoryList(list);
    const next = base.filter((e) => normalizeRepoKey(e.repo) !== key);
    next.unshift({ ...entry, repo: key });
    const cap = Math.max(1, Number(limit) || DEFAULT_LIMIT);
    return next.slice(0, cap);
  }

  root.RepoGossipHistoryLogic = {
    DEFAULT_LIMIT,
    normalizeRepoKey,
    resolveRepoKey,
    sanitizeTempLevel,
    normalizeHistoryList,
    findHistoryEntry,
    slimGossipData,
    buildHistoryEntry,
    upsertHistoryList,
  };
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : this,
);
