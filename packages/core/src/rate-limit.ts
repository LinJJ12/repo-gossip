/** In-memory fixed-window rate limiter (per process; weak under multi-instance). */

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

type WindowEntry = {
  count: number;
  windowStartMs: number;
};

const stores = new Map<string, Map<string, WindowEntry>>();

// 键来自客户端可影响的输入(IP 头 / repo 串),无上限会被伪键撑爆内存。
// 超限时先清过期窗口,仍满则按插入序淘汰最旧一半。
const MAX_ENTRIES_PER_STORE = 10_000;

function storeFor(namespace: string): Map<string, WindowEntry> {
  let s = stores.get(namespace);
  if (!s) {
    s = new Map();
    stores.set(namespace, s);
  }
  return s;
}

function evictStore(store: Map<string, WindowEntry>, windowMs: number, nowMs: number): void {
  for (const [key, entry] of store) {
    if (nowMs - entry.windowStartMs >= windowMs) store.delete(key);
  }
  while (store.size >= MAX_ENTRIES_PER_STORE) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Consume one unit from a fixed window.
 * @param windowMs window length (e.g. 3600_000)
 * @param limit max requests per window
 */
export function consumeRateLimit(
  namespace: string,
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now(),
): RateLimitResult {
  if (limit <= 0) {
    return { ok: true, remaining: Number.POSITIVE_INFINITY };
  }
  const store = storeFor(namespace);
  const existing = store.get(key);
  if (!existing || nowMs - existing.windowStartMs >= windowMs) {
    if (!store.has(key) && store.size >= MAX_ENTRIES_PER_STORE) {
      evictStore(store, windowMs, nowMs);
    }
    store.set(key, { count: 1, windowStartMs: nowMs });
    return { ok: true, remaining: Math.max(0, limit - 1) };
  }
  if (existing.count >= limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((existing.windowStartMs + windowMs - nowMs) / 1000),
    );
    return { ok: false, retryAfterSec };
  }
  existing.count += 1;
  return { ok: true, remaining: Math.max(0, limit - existing.count) };
}

/** Test helper — clear all windows. */
export function resetRateLimitStores(): void {
  stores.clear();
}

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

const MIN_GOSSIP_DAYS = 1;
const MAX_GOSSIP_DAYS = 90;

/** Clamp sinceDays for gossip requests (1–90). */
export function clampGossipDays(raw: number): number {
  if (!Number.isFinite(raw)) return 14;
  return Math.min(
    MAX_GOSSIP_DAYS,
    Math.max(MIN_GOSSIP_DAYS, Math.floor(raw)),
  );
}
