import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  handleGossipApiRequest,
  handleBadgeApiRequest,
  type HttpApiRequest,
  type GossipApiDeps,
} from "../packages/core/src/http-api.js";
import {
  resetGossipCache,
} from "../packages/core/src/gossip-cache.js";
import {
  resetRateLimitStores as resetLimits,
} from "../packages/core/src/rate-limit.js";
import type { RepoScore } from "../packages/core/src/score.js";

const ENV_KEYS = [
  "GOSSIP_RATE_LIMIT_IP_PER_HOUR",
  "GOSSIP_RATE_LIMIT_REPO_PER_HOUR",
  "GOSSIP_RATE_LIMIT_BADGE_PER_HOUR",
  "GOSSIP_CACHE_TTL_SEC",
  "WEBHOOK_SECRET",
  "GOSSIP_REQUIRE_WEBHOOK_SECRET",
  "GOSSIP_CORS_ORIGINS",
  "VERCEL",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(
    ENV_KEYS.map((k) => [k, process.env[k]]),
  );
  for (const k of ENV_KEYS) delete process.env[k];
  resetGossipCache();
  resetLimits();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetGossipCache();
  resetLimits();
});

function postReq(body: string, headers: HttpApiRequest["headers"] = {}): HttpApiRequest {
  return { method: "POST", url: "/api/gossip", headers, bodyText: body };
}

function fakeDeps(calls: { gossip?: number; score?: number; compare?: number } = {}): GossipApiDeps {
  return {
    runGossip: async (opts) => {
      calls.gossip = (calls.gossip ?? 0) + 1;
      return {
        tabloid: { epicTitle: `八卦 ${opts.repo}` },
        message: { plain: `plain ${opts.repo}`, markdown: `**md** ${opts.repo}` },
        mode: opts.offline ? "offline" : "llm",
        llmError: undefined,
        warnings: [],
      } as Awaited<ReturnType<NonNullable<GossipApiDeps["runGossip"]>>>;
    },
    runScore: async (opts) => {
      calls.score = (calls.score ?? 0) + 1;
      return {
        score: { total: 88 } as RepoScore,
        message: { plain: `score ${opts.repo}`, markdown: `score ${opts.repo}` },
        missing: [],
      } as Awaited<ReturnType<NonNullable<GossipApiDeps["runScore"]>>>;
    },
    runCompare: async (opts) => {
      calls.compare = (calls.compare ?? 0) + 1;
      return {
        entries: opts.repos.map((r) => ({ repo: r, score: null })),
        message: { plain: `cmp ${opts.repos.join("+")}`, markdown: `cmp` },
      } as Awaited<ReturnType<NonNullable<GossipApiDeps["runCompare"]>>>;
    },
  };
}

const scoreStubForBadge = async () => ({
  score: {
    total: 88,
    grade: { id: "gold", label: "足金", emoji: "🥇" },
  } as unknown as RepoScore,
  message: { plain: "", markdown: "" },
  missing: [],
});

describe("handleGossipApiRequest · 路由", () => {
  it("OPTIONS → 204 + CORS 头", async () => {
    const res = await handleGossipApiRequest({
      method: "OPTIONS",
      url: "/api/gossip",
      headers: { origin: "https://a.dev" },
    });
    assert.equal(res.status, 204);
    assert.ok(res.headers["Access-Control-Allow-Origin"]);
    assert.equal(res.body, "");
  });

  it("GET 无参数 → 200 健康检查(公开,不鉴权)", async () => {
    process.env.GOSSIP_REQUIRE_WEBHOOK_SECRET = "1";
    const res = await handleGossipApiRequest({
      method: "GET",
      url: "/api/gossip",
      headers: {},
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("不支持的 method → 405", async () => {
    const res = await handleGossipApiRequest({
      method: "PUT",
      url: "/api/gossip",
      headers: {},
    });
    assert.equal(res.status, 405);
  });
});

describe("handleGossipApiRequest · 校验", () => {
  it("POST 非法 JSON → 400", async () => {
    const res = await handleGossipApiRequest(postReq("{oops"));
    assert.equal(res.status, 400);
    assert.match(res.body, /invalid JSON/);
  });

  it("POST 缺 repo → 400 missing repo", async () => {
    const res = await handleGossipApiRequest(postReq("{}"));
    assert.equal(res.status, 400);
    assert.match(res.body, /missing repo/);
  });

  it("POST compare 缺 repos → 400 用量提示", async () => {
    const res = await handleGossipApiRequest(postReq('{"mode":"compare"}'));
    assert.equal(res.status, 400);
    assert.match(res.body, /compare needs repos/);
  });

  it("POST 非法 repo 表达式 → 400 parseRepoRef 报错", async () => {
    const res = await handleGossipApiRequest(postReq('{"repo":"not a repo"}'));
    assert.equal(res.status, 400);
    assert.match(res.body, /Cannot parse repo/);
  });

  it("超大 bodyText → 413", async () => {
    const res = await handleGossipApiRequest(
      postReq(JSON.stringify({ repo: "a/b", pad: "x".repeat(70_000) })),
    );
    assert.equal(res.status, 413);
  });
});

describe("handleGossipApiRequest · 鉴权", () => {
  it("配置 WEBHOOK_SECRET 后错误 Bearer → 401;正确 → 200", async () => {
    process.env.WEBHOOK_SECRET = "s3cret";
    const bad = await handleGossipApiRequest(
      postReq('{"repo":"a/b","offline":true}', { authorization: "Bearer wrong" }),
    );
    assert.equal(bad.status, 401);

    const calls: { gossip?: number } = {};
    const ok = await handleGossipApiRequest(
      postReq('{"repo":"a/b","offline":true}', { authorization: "Bearer s3cret" }),
      fakeDeps(calls),
    );
    assert.equal(ok.status, 200);
  });
});

describe("handleGossipApiRequest · 各模式与缓存", () => {
  it("score / compare / tabloid 模式各走各的 runner", async () => {
    const calls: { gossip?: number; score?: number; compare?: number } = {};
    const deps = fakeDeps(calls);

    const score = await handleGossipApiRequest(
      postReq('{"repo":"a/b","mode":"score"}'),
      deps,
    );
    assert.equal(score.status, 200);
    assert.match(score.body, /"kind":"score"/);

    const compare = await handleGossipApiRequest(
      postReq('{"mode":"compare","repos":["a/b","c/d"]}'),
      deps,
    );
    assert.equal(compare.status, 200);
    assert.match(compare.body, /"kind":"compare"/);

    const tabloid = await handleGossipApiRequest(
      postReq('{"repo":"a/b","offline":true}'),
      deps,
    );
    assert.equal(tabloid.status, 200);
    assert.match(tabloid.body, /"epicTitle"/);
    assert.equal(calls.score, 1);
    assert.equal(calls.compare, 1);
    assert.equal(calls.gossip, 1);
  });

  it("markdown format 输出 markdown 字段", async () => {
    const calls: { gossip?: number } = {};
    const res = await handleGossipApiRequest(
      postReq('{"repo":"a/b","format":"markdown","offline":true}'),
      fakeDeps(calls),
    );
    const body = JSON.parse(res.body) as { markdown: string };
    assert.match(body.markdown, /^\*\*md\*\*/);
  });

  it("第二次相同请求命中缓存,不消耗 runner、不消耗 IP 限额", async () => {
    process.env.GOSSIP_RATE_LIMIT_IP_PER_HOUR = "1";
    const calls: { score?: number } = {};
    const deps = fakeDeps(calls);
    const bodyText = '{"repo":"a/b","mode":"score"}';

    const first = await handleGossipApiRequest(postReq(bodyText), deps);
    assert.equal(first.headers["X-Cache"], "MISS");

    const second = await handleGossipApiRequest(postReq(bodyText), deps);
    assert.equal(second.headers["X-Cache"], "HIT");
    assert.equal(second.status, 200);
    assert.equal(calls.score, 1);
  });

  it("BYOK 头改变缓存键(不同指纹不共享缓存)", async () => {
    const calls: { score?: number } = {};
    const deps = fakeDeps(calls);
    const bodyText = '{"repo":"a/b","mode":"score"}';
    await handleGossipApiRequest(postReq(bodyText), deps);
    await handleGossipApiRequest(
      { ...postReq(bodyText), headers: { "x-github-token": "ghp_x" } },
      deps,
    );
    assert.equal(calls.score, 2);
  });
});

describe("handleGossipApiRequest · 限流与脱敏", () => {
  it("超过 IP 限额 → 429 + Retry-After", async () => {
    process.env.GOSSIP_RATE_LIMIT_IP_PER_HOUR = "1";
    const deps = fakeDeps({});
    const first = await handleGossipApiRequest(
      postReq('{"repo":"a/b","mode":"score"}'),
      deps,
    );
    assert.equal(first.status, 200);
    const second = await handleGossipApiRequest(
      postReq('{"repo":"c/d","mode":"score"}'),
      deps,
    );
    assert.equal(second.status, 429);
    assert.match(second.body, /rate limit exceeded \(ip\)/);
    assert.ok(second.headers["Retry-After"]);
  });

  it("runner 抛错 → 500 笼统文案,不泄漏内部信息", async () => {
    const res = await handleGossipApiRequest(postReq('{"repo":"a/b"}'), {
      runGossip: async () => {
        throw new Error("SECRET: db password hunter2");
      },
    });
    assert.equal(res.status, 500);
    const body = JSON.parse(res.body) as { error: string };
    assert.equal(body.error, "internal error");
    assert.ok(!res.body.includes("hunter2"));
  });

  it("GOSSIP_CORS_ORIGINS 白名单时回显 Origin", async () => {
    process.env.GOSSIP_CORS_ORIGINS = "https://allowed.dev";
    const res = await handleGossipApiRequest({
      method: "OPTIONS",
      url: "/api/gossip",
      headers: { origin: "https://allowed.dev" },
    });
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://allowed.dev");
    assert.equal(res.headers["Vary"], "Origin");
  });
});

describe("handleBadgeApiRequest · 永不破图", () => {
  it("非 GET → 405;非法路径 → 400", async () => {
    const wrongMethod = await handleBadgeApiRequest({
      method: "POST",
      owner: "a",
      repo: "b",
      headers: {},
    });
    assert.equal(wrongMethod.status, 405);

    const badPath = await handleBadgeApiRequest({
      method: "GET",
      owner: "bad owner!",
      repo: "b",
      headers: {},
    });
    assert.equal(badPath.status, 400);
  });

  it("评分成功 → SVG + 长缓存;再次命中缓存只调一次 runner", async () => {
    let calls = 0;
    const deps = {
      runScore: async () => {
        calls += 1;
        return scoreStubForBadge();
      },
    };
    const first = await handleBadgeApiRequest({
      method: "GET",
      owner: "a",
      repo: "b.svg",
      headers: {},
    }, deps);
    assert.equal(first.status, 200);
    assert.match(first.headers["Content-Type"] ?? "", /image\/svg/);
    assert.match(first.body, /#d4a017/);
    assert.equal(first.headers["X-Cache"], "MISS");

    const second = await handleBadgeApiRequest({
      method: "GET",
      owner: "a",
      repo: "b.svg",
      headers: {},
    }, deps);
    assert.equal(second.headers["X-Cache"], "HIT");
    assert.equal(calls, 1);
  });

  it("runner 失败 → 200 灰色 N/A 徽章", async () => {
    const res = await handleBadgeApiRequest({
      method: "GET",
      owner: "a",
      repo: "b",
      headers: {},
    }, {
      runScore: async () => {
        throw new Error("github 403");
      },
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /N\/A/);
    assert.equal(res.headers["X-Cache"], "BYPASS");
  });

  it("超过徽章 IP 限额 → 200 N/A + Retry-After + no-store", async () => {
    process.env.GOSSIP_RATE_LIMIT_BADGE_PER_HOUR = "1";
    const deps = { runScore: scoreStubForBadge };
    const first = await handleBadgeApiRequest(
      { method: "GET", owner: "a", repo: "b", headers: {} },
      deps,
    );
    assert.equal(first.headers["X-Cache"], "MISS");
    const second = await handleBadgeApiRequest(
      { method: "GET", owner: "c", repo: "d", headers: {} },
      deps,
    );
    assert.equal(second.status, 200);
    assert.match(second.body, /N\/A/);
    assert.equal(second.headers["X-Cache"], "RATE-LIMITED");
    assert.ok(second.headers["Retry-After"]);
    assert.equal(second.headers["Cache-Control"], "no-store");
  });

  it("lang=en 徽章标签为 Gold", async () => {
    const res = await handleBadgeApiRequest({
      method: "GET",
      owner: "a",
      repo: "b",
      lang: "en",
      headers: {},
    }, { runScore: scoreStubForBadge });
    assert.match(res.body, />Gold</);
  });
});
