import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  consumeRateLimit,
  resetRateLimitStores,
  parsePositiveInt,
  buildGossipCacheKey,
  byokFingerprint,
  getGossipCache,
  setGossipCache,
  resetGossipCache,
} from "../packages/core/src/index.js";

describe("consumeRateLimit", () => {
  beforeEach(() => {
    resetRateLimitStores();
  });

  it("allows up to limit then blocks", () => {
    const t0 = 1_000_000;
    assert.equal(consumeRateLimit("t", "a", 2, 60_000, t0).ok, true);
    assert.equal(consumeRateLimit("t", "a", 2, 60_000, t0 + 1).ok, true);
    const blocked = consumeRateLimit("t", "a", 2, 60_000, t0 + 2);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.ok(blocked.retryAfterSec >= 1);
  });

  it("resets after window", () => {
    const t0 = 2_000_000;
    assert.equal(consumeRateLimit("t", "b", 1, 1000, t0).ok, true);
    assert.equal(consumeRateLimit("t", "b", 1, 1000, t0 + 500).ok, false);
    assert.equal(consumeRateLimit("t", "b", 1, 1000, t0 + 1000).ok, true);
  });
});

describe("parsePositiveInt", () => {
  it("falls back on junk", () => {
    assert.equal(parsePositiveInt(undefined, 30), 30);
    assert.equal(parsePositiveInt("x", 30), 30);
    assert.equal(parsePositiveInt("12", 30), 12);
  });
});

describe("clampGossipDays", () => {
  it("clamps to 1..90", async () => {
    const { clampGossipDays } = await import(
      "../packages/core/src/rate-limit.js"
    );
    assert.equal(clampGossipDays(0), 1);
    assert.equal(clampGossipDays(999), 90);
    assert.equal(clampGossipDays(7.9), 7);
    assert.equal(clampGossipDays(Number.NaN), 14);
  });
});

describe("gossip cache", () => {
  beforeEach(() => {
    resetGossipCache();
  });

  it("fingerprints without secrets", () => {
    assert.equal(
      byokFingerprint({ GITHUB_TOKEN: "secret", LLM_API_KEY: "sk" }),
      "g1:l1:-:-",
    );
  });

  it("hits within TTL and misses after", () => {
    const key = buildGossipCacheKey({
      repo: "a/b",
      days: 14,
      offline: true,
      format: "web",
      byokFingerprint: "g0:l0:-:-",
    });
    setGossipCache(key, { status: 200, body: { ok: true } }, 10, 1000);
    assert.deepEqual(getGossipCache(key, 1500), {
      status: 200,
      body: { ok: true },
    });
    assert.equal(getGossipCache(key, 12_000), undefined);
  });

  it("separates cache by format", () => {
    const a = buildGossipCacheKey({
      repo: "a/b",
      days: 14,
      offline: false,
      format: "web",
      byokFingerprint: "g0:l0:-:-",
    });
    const b = buildGossipCacheKey({
      repo: "a/b",
      days: 14,
      offline: false,
      format: "json",
      byokFingerprint: "g0:l0:-:-",
    });
    assert.notEqual(a, b);
  });
});
