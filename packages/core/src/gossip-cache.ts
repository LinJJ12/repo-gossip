/** In-memory TTL cache for gossip API responses (per process). */

export type GossipCacheEntry = {
  status: number;
  body: unknown;
};

type TimedEntry = GossipCacheEntry & { expiresAtMs: number };

const cache = new Map<string, TimedEntry>();

export function buildGossipCacheKey(parts: {
  repo: string;
  days: number;
  offline: boolean;
  format: string;
  /** Non-secret fingerprint of BYOK usage */
  byokFingerprint: string;
}): string {
  return [
    parts.repo.trim().toLowerCase(),
    String(parts.days),
    parts.offline ? "1" : "0",
    parts.format.trim().toLowerCase() || "web",
    parts.byokFingerprint,
  ].join("|");
}

/** Fingerprint BYOK without including secret material. */
export function byokFingerprint(env: {
  GITHUB_TOKEN?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
}): string {
  return [
    env.GITHUB_TOKEN ? "g1" : "g0",
    env.LLM_API_KEY ? "l1" : "l0",
    env.LLM_BASE_URL?.trim() || "-",
    env.LLM_MODEL?.trim() || "-",
  ].join(":");
}

export function getGossipCache(
  key: string,
  nowMs = Date.now(),
): GossipCacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAtMs <= nowMs) {
    cache.delete(key);
    return undefined;
  }
  return { status: hit.status, body: hit.body };
}

export function setGossipCache(
  key: string,
  entry: GossipCacheEntry,
  ttlSec: number,
  nowMs = Date.now(),
): void {
  if (ttlSec <= 0) return;
  cache.set(key, {
    ...entry,
    expiresAtMs: nowMs + ttlSec * 1000,
  });
}

export function resetGossipCache(): void {
  cache.clear();
}
