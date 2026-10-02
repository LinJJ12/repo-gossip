/**
 * repo-gossip 历史记录纯逻辑 —— 单一实现(单源)。
 *
 * 同时服务三个消费方,平台约束决定了它必须保持经典脚本(IIFE → globalThis,
 * MV3 内容脚本 / importScripts 不能用 ES 模块,扩展保持零构建):
 * - 扩展内容脚本(manifest content_scripts)
 * - 扩展 service worker(background.js importScripts)与扩展页(popup/app)
 * - Web 预览站(apps/web/src/history.ts 以副作用导入本文件后做类型门面)
 *
 * 语义取严格版(原 web 版):normalizeHistoryList 会重新 slim,无 analyzable
 * tabloid 的脏行直接丢弃,防止存储坏数据崩渲染。修改本文件后同时跑
 * test/web-history.test.ts 与 test/extension-panel-history.test.ts
 * (两侧消费同一实现)。
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
   * Keep fields needed for structured panel render + linkify; drop bulky commit bodies.
   * 严格形态:温度恒有默认值、stars 数值化、markdown 回退 plain(与 web 版一致)。
   * @param {any} data
   * @returns {object | null}
   */
  function slimGossipData(data) {
    if (!data || typeof data !== "object") return null;
    const analyzed = data.tabloid?.analyzed;
    if (!analyzed || typeof analyzed !== "object") return null;

    const snap = analyzed.snapshot;
    const rawCommits = Array.isArray(snap?.commits) ? snap.commits : [];
    const commits = rawCommits.map((/** @type {any} */ c) => ({
      authorLogin: c?.authorLogin,
      author: String(c?.author ?? ""),
    }));
    const warnings = Array.isArray(data.warnings)
      ? data.warnings.map((/** @type {any} */ w) => String(w)).slice(0, 30)
      : undefined;
    const temp = analyzed.temperature;
    const commitCount =
      typeof snap?.commitCount === "number" &&
      Number.isFinite(snap.commitCount)
        ? snap.commitCount
        : rawCommits.length;

    const plain =
      typeof data.message?.plain === "string"
        ? data.message.plain
        : JSON.stringify(data, null, 2);

    const starsRaw = Number(snap?.stars);
    const stars = Number.isFinite(starsRaw) ? starsRaw : 0;

    return {
      mode: data.mode,
      llmError: data.llmError,
      warnings,
      message: {
        plain,
        // 面板不渲染 markdown,但保持 TabloidPayload 形态完整。
        markdown:
          typeof data.message?.markdown === "string"
            ? data.message.markdown
            : plain,
      },
      tabloid: {
        epicTitle: String(data.tabloid?.epicTitle ?? ""),
        temperatureLine: String(data.tabloid?.temperatureLine ?? ""),
        awardsNarrative: Array.isArray(data.tabloid?.awardsNarrative)
          ? data.tabloid.awardsNarrative
          : [],
        translations: Array.isArray(data.tabloid?.translations)
          ? data.tabloid.translations
          : [],
        easterEggLines: Array.isArray(data.tabloid?.easterEggLines)
          ? data.tabloid.easterEggLines
          : [],
        closing: String(data.tabloid?.closing ?? ""),
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
            commitCount,
          },
        },
      },
    };
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
      // Re-slim so corrupt / partial payloads cannot crash renderers.
      const slim = slimGossipData(e.data);
      if (!slim?.tabloid?.analyzed) continue;
      const prev = byRepo.get(key);
      const savedAt = Number(e.savedAt) || 0;
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
      epicTitle: slim.tabloid.epicTitle
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
