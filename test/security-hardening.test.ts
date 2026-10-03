import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildGossipCacheKey,
  getGossipCache,
  setGossipCache,
  resetGossipCache,
  consumeRateLimit,
  resetRateLimitStores,
  parseRepoRef,
  loadEnv,
  parseCompareRepos,
  resolveBadgeRepoParam,
  matchLooseRepo,
  resolveDetailBudget,
  llmDegradedNote,
  toFeishuCard,
  splitGithubLinkParts,
  computeRepoScore,
  clientIpFromHeaders,
  type RepoScoreInput,
} from "../packages/core/src/index.js";
import { verifyFeishuSignature } from "../apps/bot/src/platforms/feishu.js";

// ---------------------------------------------------------------------------
// 缓存键:internal / lang 必须参与,防内部 llmError 经缓存泄漏、zh/en 互覆
// ---------------------------------------------------------------------------

describe("gossip cache key", () => {
  it("separates internal from public", () => {
    const shared = {
      repo: "a/b",
      days: 14,
      offline: false,
      format: "web",
      byokFingerprint: "g0:l0:-:-",
    };
    assert.notEqual(
      buildGossipCacheKey({ ...shared, internal: true }),
      buildGossipCacheKey({ ...shared, internal: false }),
    );
  });

  it("separates locales", () => {
    const shared = {
      repo: "a/b",
      days: 0,
      offline: true,
      format: "score",
      byokFingerprint: "",
    };
    assert.notEqual(
      buildGossipCacheKey({ ...shared, lang: "zh" }),
      buildGossipCacheKey({ ...shared, lang: "en" }),
    );
  });

  it("evicts oldest entries beyond capacity", () => {
    resetGossipCache();
    // 500 是内部上限;写 520 个键,最早的应被淘汰
    for (let i = 0; i < 520; i++) {
      setGossipCache(
        `k${i}`,
        { status: 200, body: { i } },
        600,
        1000 + i,
      );
    }
    assert.equal(getGossipCache("k0"), undefined);
    assert.equal(getGossipCache("k519", 1000 + 519 + 1)?.status, 200);
    resetGossipCache();
  });
});

describe("rate limit store bounds", () => {
  it("still limits after many unique keys", () => {
    resetRateLimitStores();
    for (let i = 0; i < 5000; i++) {
      consumeRateLimit("t", `key-${i}`, 1, 60_000, 1000);
    }
    // 老键被淘汰后窗口重置,新 key 正常计数
    assert.equal(consumeRateLimit("t", "fresh", 1, 60_000, 1001).ok, true);
    assert.equal(consumeRateLimit("t", "fresh", 1, 60_000, 1002).ok, false);
    resetRateLimitStores();
  });
});

// ---------------------------------------------------------------------------
// parseRepoRef / loadEnv / compare / badge / loose pattern
// ---------------------------------------------------------------------------

describe("parseRepoRef", () => {
  it("accepts normal owner/repo and GitHub URLs", () => {
    assert.deepEqual(parseRepoRef("vercel/next.js"), {
      owner: "vercel",
      repo: "next.js",
    });
    assert.deepEqual(parseRepoRef("https://github.com/a-b/c_d.e"), {
      owner: "a-b",
      repo: "c_d.e",
    });
    assert.deepEqual(parseRepoRef("https://github.com/a/b.git"), {
      owner: "a",
      repo: "b",
    });
  });

  it("rejects junk segments with a parse error (400 口径)", () => {
    assert.throws(() => parseRepoRef("x?y/b"), /Cannot parse repo/);
    assert.throws(() => parseRepoRef("a/b|c"), /Cannot parse repo/);
    assert.throws(() => parseRepoRef("a/.."), /Cannot parse repo/);
    assert.throws(() => parseRepoRef(".a/b"), /Cannot parse repo/);
  });
});

describe("loadEnv numeric tolerance", () => {
  it("falls back to defaults on junk values instead of throwing", () => {
    const env = loadEnv({
      LLM_TIMEOUT_MS: "10s",
      GOSSIP_MAX_COMMIT_DETAILS: "abc",
    });
    assert.equal(env.LLM_TIMEOUT_MS, 20_000);
    assert.equal(env.GOSSIP_MAX_COMMIT_DETAILS, 20);
  });

  it("treats empty strings as unset", () => {
    const env = loadEnv({ LLM_TIMEOUT_MS: "", GOSSIP_MAX_COMMIT_DETAILS: "" });
    assert.equal(env.LLM_TIMEOUT_MS, 20_000);
    assert.equal(env.GOSSIP_MAX_COMMIT_DETAILS, 20);
  });

  it("accepts valid values", () => {
    const env = loadEnv({ LLM_TIMEOUT_MS: "5000", GOSSIP_MAX_COMMIT_DETAILS: "0" });
    assert.equal(env.LLM_TIMEOUT_MS, 5000);
    assert.equal(env.GOSSIP_MAX_COMMIT_DETAILS, 0);
  });
});

describe("parseCompareRepos", () => {
  it("rejects malformed repo strings (markdown 注入面)", () => {
    assert.throws(() => parseCompareRepos(["a|b", "c/d"]), /invalid repo/);
    assert.throws(() => parseCompareRepos("a/b [x](https://evil) c/d"), /invalid repo/);
  });

  it("still accepts 2-4 valid repos", () => {
    assert.deepEqual(parseCompareRepos("a/b c/d"), ["a/b", "c/d"]);
  });
});

describe("resolveBadgeRepoParam", () => {
  it("rejects dot-only and leading/trailing-dot repos", () => {
    assert.equal(resolveBadgeRepoParam("owner", ".."), null);
    assert.equal(resolveBadgeRepoParam("owner", ".foo"), null);
    assert.equal(resolveBadgeRepoParam("owner", "foo."), null);
    assert.equal(resolveBadgeRepoParam("owner", "foo.svg"), "owner/foo");
  });
});

describe("matchLooseRepo", () => {
  it("ignores all-numeric owner chatter like 1/2", () => {
    assert.equal(matchLooseRepo("得分是 1/2 呀"), null);
    assert.equal(matchLooseRepo("12/34"), null);
  });

  it("still matches real repos, trims trailing punctuation dots", () => {
    assert.equal(matchLooseRepo("看看 facebook/react"), "facebook/react");
    assert.equal(matchLooseRepo("看 facebook/react."), "facebook/react");
    assert.equal(
      matchLooseRepo("https://github.com/vercel/next.js 不错"),
      "vercel/next.js",
    );
  });
});

describe("resolveDetailBudget", () => {
  it("treats empty string env as unset (not 0)", () => {
    const saved = process.env.GOSSIP_MAX_COMMIT_DETAILS;
    try {
      process.env.GOSSIP_MAX_COMMIT_DETAILS = "";
      assert.equal(resolveDetailBudget(), 20);
      process.env.GOSSIP_MAX_COMMIT_DETAILS = "0";
      assert.equal(resolveDetailBudget(), 0);
    } finally {
      if (saved === undefined) delete process.env.GOSSIP_MAX_COMMIT_DETAILS;
      else process.env.GOSSIP_MAX_COMMIT_DETAILS = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// format:llm 降级文案 + 飞书 lark_md 注入
// ---------------------------------------------------------------------------

describe("llmDegradedNote", () => {
  it("maps any upstream detail to the generic degraded copy", () => {
    assert.equal(
      llmDegradedNote("LLM request failed 500: internal-org=secret stuff"),
      "LLM 暂不可用,已回落本地模板",
    );
    assert.equal(llmDegradedNote(undefined), undefined);
  });
});

describe("toFeishuCard lark_md sanitization", () => {
  it("neutralizes <at> mention injection from attacker-controlled titles", () => {
    const analyzed = makeAnalyzedWithEpic(`<at id=all></at> 全体起立`);
    const card = toFeishuCard({
      epicTitle: `<at id=all></at> 全体起立`,
      awardsNarrative: [],
      temperatureLine: "",
      translations: [],
      easterEggLines: [],
      closing: "",
      analyzed,
    });
    const content = JSON.stringify(card.card);
    assert.ok(!content.includes("<at"), content);
  });
});

// 精简版 AnalyzedGossip:toFeishuCard 只读 fullName/temperature/format 输出。
function makeAnalyzedWithEpic(fullName: string) {
  return {
    snapshot: {
      ref: { owner: "a", repo: "b" },
      fullName,
      description: null,
      language: "TS",
      stars: 1,
      commits: [],
      pulls: [],
      issues: [],
      releases: [],
    },
    temperature: { emoji: "🌡️", label: "温", level: "warm", commitsLast3Days: 1, daysSinceLastCommit: 0 },
    awards: [],
    easterEggs: [],
    topAuthors: [],
    notableCommits: [],
    notablePulls: [],
    hotIssues: [],
    latestRelease: null,
  } as never;
}

// ---------------------------------------------------------------------------
// github-links:PUA 占位符伪造
// ---------------------------------------------------------------------------

describe("splitGithubLinkParts PUA hardening", () => {
  it("strips attacker-forged private-use markers", () => {
    const parts = splitGithubLinkParts("hello \uE0000\uE001 world", {
      logins: ["alice"],
    });
    const text = parts.map((p) => p.value).join("");
    assert.ok(!text.includes("\uE000"), JSON.stringify(text));
    assert.ok(text.includes("hello"), JSON.stringify(text));
  });
});

// ---------------------------------------------------------------------------
// score:0/0 关闭率不再输出 NaN%
// ---------------------------------------------------------------------------

const scoreBaseInput = {
  ref: { owner: "a", repo: "b" },
  fullName: "a/b",
  description: null,
  language: null,
  createdAt: "2020-01-01T00:00:00Z",
  pushedAt: new Date().toISOString(),
  archived: false,
  stars: 1000,
  forks: 100,
  subscribers: 10,
  openIssuesTotal: 0,
  openIssues: 0,
  licenseSpdx: "MIT",
  weeklyCommits: Array.from({ length: 52 }, () => 4),
  contributors: [{ login: "dev0", contributions: 10 }],
  contributorsTruncated: false,
  mergedPrs90d: 5,
  closedIssues90d: 0,
  releases90d: 1,
  hasCi: true,
  hasReadme: true,
  hasContributing: false,
  hasSecurity: false,
  starredAt: null,
  starTimelineSkipped: true,
  missing: [],
} satisfies RepoScoreInput;

describe("score issue close rate", () => {
  it("skips the sub-signal on 0/0 instead of NaN%", () => {
    const score = computeRepoScore(scoreBaseInput);
    const community = score.dimensions.find((d) => d.id === "community");
    const lines = JSON.stringify(community?.lines ?? []);
    assert.ok(!lines.includes("NaN"), lines);
  });
});

// ---------------------------------------------------------------------------
// clientIp:平台可信头优先
// ---------------------------------------------------------------------------

describe("clientIpFromHeaders", () => {
  it("prefers x-vercel-forwarded-for over spoofable x-forwarded-for", () => {
    assert.equal(
      clientIpFromHeaders({
        "x-vercel-forwarded-for": "203.0.113.9",
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      }),
      "203.0.113.9",
    );
  });

  it("falls back to xff first hop then x-real-ip then unknown", () => {
    assert.equal(
      clientIpFromHeaders({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }),
      "1.2.3.4",
    );
    assert.equal(clientIpFromHeaders({ "x-real-ip": "5.6.7.8" }), "5.6.7.8");
    assert.equal(clientIpFromHeaders({}), "unknown");
  });
});

// ---------------------------------------------------------------------------
// 飞书签名验证
// ---------------------------------------------------------------------------

describe("verifyFeishuSignature", () => {
  const KEY = "encrypt-key-1";
  const body = JSON.stringify({ type: "url_verification", challenge: "abc" });

  function headersFor(ts: string, nonce: string, key = KEY) {
    const sig = createHash("sha256")
      .update(`${ts}${nonce}${key}${body}`)
      .digest("hex");
    return {
      "x-lark-signature": sig,
      "x-lark-request-timestamp": ts,
      "x-lark-request-nonce": nonce,
    };
  }

  it("accepts a valid signature", () => {
    assert.equal(verifyFeishuSignature(body, headersFor("123", "n1"), KEY), true);
  });

  it("rejects tampered body / wrong key / missing headers", () => {
    assert.equal(verifyFeishuSignature(body + " ", headersFor("123", "n1"), KEY), false);
    assert.equal(verifyFeishuSignature(body, headersFor("123", "n1", "wrong"), KEY), false);
    assert.equal(verifyFeishuSignature(body, {}, KEY), false);
  });
});
