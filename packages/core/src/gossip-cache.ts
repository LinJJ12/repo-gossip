/** In-memory TTL cache for gossip API responses (per process). */

export type GossipCacheEntry = {
  status: number;
  body: unknown;
};

type TimedEntry = GossipCacheEntry & { expiresAtMs: number };

const cache = new Map<string, TimedEntry>();

// 缓存键攻击者可通过 repo/lang/headers 任意构造,无上限会被撑爆内存
// (配合 XFF 伪造还可绕过限流)。超限时先清过期,再按插入序淘汰最旧一半。
const MAX_CACHE_ENTRIES = 500;

export function buildGossipCacheKey(parts: {
  repo: string;
  days: number;
  offline: boolean;
  format: string;
  /** Non-secret fingerprint of BYOK usage */
  byokFingerprint: string;
  /** score/compare 的 zh/en 输出互不相同,必须进键。 */
  lang?: string;
  /** internal 明细(llmError 等)不入公开缓存键,防经缓存泄漏。 */
  internal?: boolean;
}): string {
  return [
    parts.repo.trim().toLowerCase(),
    String(parts.days),
    parts.offline ? "1" : "0",
    parts.format.trim().toLowerCase() || "web",
    parts.byokFingerprint,
    parts.lang?.trim().toLowerCase() || "zh",
    parts.internal ? "1" : "0",
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
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    evictCache(nowMs);
  }
  cache.set(key, {
    ...entry,
    expiresAtMs: nowMs + ttlSec * 1000,
  });
}

function evictCache(nowMs: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAtMs <= nowMs) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function resetGossipCache(): void {
  cache.clear();
}
