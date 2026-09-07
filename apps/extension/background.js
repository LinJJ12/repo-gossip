/** @typedef {{
 *   apiBaseUrl: string;
 *   githubToken: string;
 *   llmApiKey: string;
 *   llmBaseUrl: string;
 *   llmModel: string;
 *   days: number;
 *   offline: boolean;
 * }} GossipSettings */

importScripts("history-logic.js");

const HistoryLogic = globalThis.RepoGossipHistoryLogic;
const HISTORY_KEY = "repoGossipHistory";
const HISTORY_LIMIT = HistoryLogic?.DEFAULT_LIMIT || 20;

/** Serializes history RMW across popup / full page / content script. */
let historyWriteChain = Promise.resolve();

const DEFAULTS = {
  apiBaseUrl: "http://localhost:5173",
  githubToken: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmModel: "",
  days: 14,
  offline: false,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_APP") {
    void openApp(message.view === "settings" ? "settings" : "compose");
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "HISTORY_UPSERT") {
    void (async () => {
      try {
        const list = await upsertHistoryFromData(message.repo, message.data);
        sendResponse({ ok: true, list });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }
  if (message?.type !== "GOSSIP_FETCH") return false;
  void (async () => {
    try {
      const result = await fetchGossip(message.repo);
      sendResponse({ ok: true, data: result });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;
});

/**
 * @param {() => Promise<T>} fn
 * @template T
 * @returns {Promise<T>}
 */
function withHistoryLock(fn) {
  const run = historyWriteChain.then(fn, fn);
  historyWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * @returns {Promise<any[]>}
 */
async function loadHistory() {
  const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return HistoryLogic
    ? HistoryLogic.normalizeHistoryList(stored[HISTORY_KEY])
    : Array.isArray(stored[HISTORY_KEY])
      ? stored[HISTORY_KEY]
      : [];
}

/**
 * @param {unknown} repo
 * @param {unknown} data
 * @returns {Promise<any[]>}
 */
async function upsertHistoryFromData(repo, data) {
  if (!HistoryLogic) {
    throw new Error("history-logic unavailable");
  }
  const entry = HistoryLogic.buildHistoryEntry(repo, data);
  if (!entry) return loadHistory();
  return withHistoryLock(async () => {
    const list = await loadHistory();
    const next = HistoryLogic.upsertHistoryList(list, entry, HISTORY_LIMIT);
    try {
      await chrome.storage.local.set({ [HISTORY_KEY]: next });
      return next;
    } catch (err) {
      const trimmed = next.slice(0, Math.max(1, Math.floor(next.length / 2)));
      try {
        await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
        return trimmed;
      } catch (err2) {
        console.warn(
          "[repo-gossip] history save failed",
          err2 instanceof Error ? err2.message : err2,
          err instanceof Error ? err.message : err,
        );
        return list;
      }
    }
  });
}

/**
 * Open or focus the full-page app (compose by default).
 * @param {"compose" | "settings"} [view]
 */
async function openApp(view = "compose") {
  const base = chrome.runtime.getURL("app.html");
  const target = `${base}#${view === "settings" ? "settings" : "compose"}`;
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => typeof t.url === "string" && t.url.startsWith(base));
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true, url: target });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: target });
}

/**
 * @returns {Promise<GossipSettings>}
 */
async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

/**
 * @param {string} repo
 */
async function fetchGossip(repo) {
  if (typeof repo !== "string" || !repo.trim()) {
    throw new Error("缺少仓库名");
  }
  const settings = await loadSettings();
  const base = String(settings.apiBaseUrl || "").replace(/\/$/, "");
  if (!base) {
    throw new Error("请先在扩展设置里填写 API Base URL");
  }
  try {
    const u = new URL(base);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("API Base URL 仅支持 http/https");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("仅支持")) throw err;
    throw new Error("API Base URL 无效");
  }

  const githubToken = String(settings.githubToken ?? "").trim();
  const llmApiKey = String(settings.llmApiKey ?? "").trim();
  const llmBaseUrl = String(settings.llmBaseUrl ?? "").trim();
  const llmModel = String(settings.llmModel ?? "").trim();

  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json" };
  if (githubToken) headers["x-github-token"] = githubToken;
  if (llmApiKey) headers["x-llm-api-key"] = llmApiKey;
  if (llmBaseUrl) headers["x-llm-base-url"] = llmBaseUrl;
  if (llmModel) headers["x-llm-model"] = llmModel;

  const days = Math.min(90, Math.max(1, Number(settings.days) || 14));

  const res = await fetch(`${base}/api/gossip`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      repo: repo.trim(),
      days,
      offline: Boolean(settings.offline),
      format: "web",
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const retry =
      typeof json.retryAfterSec === "number"
        ? `（约 ${json.retryAfterSec}s 后重试）`
        : "";
    throw new Error((json.error || `HTTP ${res.status}`) + retry);
  }
  return json;
}
