/** @typedef {{
 *   apiBaseUrl: string;
 *   githubToken: string;
 *   llmApiKey: string;
 *   llmBaseUrl: string;
 *   llmModel: string;
 *   days: number;
 *   offline: boolean;
 * }} GossipSettings */

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
    throw new Error("请先在扩展选项里填写 API Base URL");
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

  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json" };
  if (settings.githubToken.trim()) {
    headers["x-github-token"] = settings.githubToken.trim();
  }
  if (settings.llmApiKey.trim()) {
    headers["x-llm-api-key"] = settings.llmApiKey.trim();
  }
  if (settings.llmBaseUrl.trim()) {
    headers["x-llm-base-url"] = settings.llmBaseUrl.trim();
  }
  if (settings.llmModel.trim()) {
    headers["x-llm-model"] = settings.llmModel.trim();
  }

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
