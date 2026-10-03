/**
 * /api/gossip 与 /api/badge 的框架无关请求处理。
 * Vercel(api/*)与 Vite dev 中间件(apps/web/vite.config.ts)都只做协议转换,
 * 路由 / 校验 / 鉴权 / 限流 / 缓存 / 错误脱敏全部收敛在这里。
 * deps 可注入 runGossip/runScore/runCompare 供单测打桩。
 */

import { parseRepoRef } from "./config.js";
import {
  clampGossipDays,
  parsePositiveInt,
  consumeRateLimit,
} from "./rate-limit.js";
import { parseCompareRepos } from "./compare.js";
import {
  byokFingerprint,
  buildGossipCacheKey,
  getGossipCache,
  setGossipCache,
} from "./gossip-cache.js";
import {
  extractByokEnv,
  extractWebhookCredential,
  decideWebhookAuth,
  resolveCorsAllowOrigin,
  GOSSIP_CORS_ALLOW_HEADERS,
  GOSSIP_CORS_ALLOW_METHODS,
  type HeaderBag,
} from "./byok.js";
import {
  formatBadgeSvg,
  formatBadgeEndpoint,
  badgeErrorSvg,
  badgeEndpointError,
  resolveBadgeRequest,
} from "./badge.js";
import { runGossip, runScore, runCompare } from "./gossip.js";
import { toDiscordEmbed, toFeishuCard } from "./format.js";
import type { ScoreLocale } from "./types.js";

export type HttpApiRequest = {
  method: string;
  /** path + query,例如 "/api/gossip?repo=owner/repo" */
  url: string;
  headers: HeaderBag;
  /** 原始请求体(未解析);与 bodyJson 二选一。 */
  bodyText?: string;
  /** 已解析的请求体(Vercel req.body);优先于 bodyText。 */
  bodyJson?: unknown;
};

export type HttpApiResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type GossipApiDeps = {
  runGossip?: typeof runGossip;
  runScore?: typeof runScore;
  runCompare?: typeof runCompare;
};

export type BadgeApiDeps = {
  runScore?: typeof runScore;
};

const WINDOW_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 64_000;

const JSON_HEADERS = { "Content-Type": "application/json" };

export function isProductionRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function requireWebhookSecretFlag(): boolean {
  const raw = process.env.GOSSIP_REQUIRE_WEBHOOK_SECRET?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

function singleHeader(
  headers: HeaderBag,
  name: string,
): string | undefined {
  const raw =
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

/**
 * 代理头优先取客户端 IP。
 * Vercel 平台注入的 x-vercel-forwarded-for 不可被客户端伪造,优先采用;
 * x-forwarded-for 的链首是客户端自报值,仅作无平台头的部署的尽力而为 fallback
 * (此类部署下按 IP 限流可被轮换 XFF 绕过,文档已标注)。
 */
export function clientIpFromHeaders(headers: HeaderBag): string {
  const vercel = singleHeader(headers, "x-vercel-forwarded-for");
  if (vercel?.trim()) return vercel.split(",")[0]!.trim();
  const forwarded = singleHeader(headers, "x-forwarded-for");
  if (forwarded?.trim()) return forwarded.split(",")[0]!.trim();
  const real = singleHeader(headers, "x-real-ip");
  if (real?.trim()) return real.trim();
  return "unknown";
}

function corsHeaders(headers: HeaderBag): Record<string, string> {
  const allowOrigin = resolveCorsAllowOrigin(
    singleHeader(headers, "origin"),
    process.env.GOSSIP_CORS_ORIGINS,
  );
  const out: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": GOSSIP_CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": GOSSIP_CORS_ALLOW_HEADERS,
  };
  if (allowOrigin !== "*") out["Vary"] = "Origin";
  return out;
}

function json(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): HttpApiResponse {
  return {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(payload),
  };
}

/** 500 一律笼统文案,内部细节进服务端日志,不回给公开客户端。 */
function internalError(err: unknown, scope: string): HttpApiResponse {
  console.error(`[${scope}] internal error:`, err);
  return json(500, { error: "internal error" });
}

type GossipIntent = {
  repo: string;
  offline: boolean;
  format: string;
  days: number;
  mode?: string;
  /** GET 查询串为逗号串,POST body 为数组;parseCompareRepos 两者都收。 */
  repos?: string | string[];
  lang?: string;
};

/** GET /api/gossip 无参数 = 健康检查(公开,不做鉴权)。 */
export function gossipUsagePayload(): Record<string, unknown> {
  return {
    ok: true,
    usage:
      'GET /api/gossip?repo=owner/repo or POST {"repo":"owner/repo","format":"web"}; score: {"mode":"score"}; compare: {"mode":"compare","repos":["a/b","c/d"]}',
  };
}

export async function handleGossipApiRequest(
  req: HttpApiRequest,
  deps: GossipApiDeps = {},
): Promise<HttpApiResponse> {
  const impl = {
    doGossip: deps.runGossip ?? runGossip,
    doScore: deps.runScore ?? runScore,
    doCompare: deps.runCompare ?? runCompare,
  };
  const cors = corsHeaders(req.headers);

  if (req.method === "OPTIONS") {
    return { status: 204, headers: cors, body: "" };
  }

  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET") {
    const repo = url.searchParams.get("repo") ?? "";
    const reposRaw = url.searchParams.getAll("repos").join(",") || undefined;
    const isCompareQuery =
      url.searchParams.get("mode") === "compare" && !!reposRaw;
    if (!repo && !isCompareQuery) {
      return json(200, gossipUsagePayload(), cors);
    }
    const auth = authorize(req);
    if (!auth.ok) return json(auth.status, { error: auth.error }, cors);
    return respondGossip(
      {
        repo,
        offline: ["1", "true"].includes(url.searchParams.get("offline") ?? ""),
        format: url.searchParams.get("format") ?? "web",
        days: clampGossipDays(Number(url.searchParams.get("days") ?? "14")),
        mode: url.searchParams.get("mode") ?? undefined,
        repos: reposRaw,
        lang: url.searchParams.get("lang") ?? undefined,
      },
      auth.internal,
      impl,
      req.headers,
      cors,
    );
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" }, cors);
  }

  const auth = authorize(req);
  if (!auth.ok) return json(auth.status, { error: auth.error }, cors);

  if (
    typeof req.bodyText === "string" &&
    Buffer.byteLength(req.bodyText) > MAX_BODY_BYTES
  ) {
    return json(413, { error: "body too large" }, cors);
  }

  let body: Record<string, unknown>;
  try {
    body = parseBodyJson(req);
  } catch {
    return json(400, { error: "invalid JSON" }, cors);
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;

  const normalizedMode = str(body.mode)?.trim().toLowerCase() ?? "";
  const hasRepos =
    (Array.isArray(body.repos) && body.repos.length > 0) ||
    (typeof body.repo === "string" && body.repo.includes(","));
  if (
    normalizedMode !== "compare" &&
    (typeof body.repo !== "string" || !body.repo)
  ) {
    return json(400, { error: "missing repo" }, cors);
  }
  if (normalizedMode === "compare" && !hasRepos) {
    return json(
      400,
      {
        error:
          'compare needs repos, e.g. {"mode":"compare","repos":["owner/a","owner/b"]}',
      },
      cors,
    );
  }

  // days 接受 number 或数字字符串("30");offline 接受 boolean / "1" / "true"。
  const daysRaw = toFiniteNumber(body.days) ?? 14;
  const offline =
    body.offline === true ||
    body.offline === "1" ||
    body.offline === "true";

  return respondGossip(
    {
      repo: str(body.repo) ?? "",
      offline,
      format: str(body.format) ?? "web",
      days: clampGossipDays(daysRaw),
      mode: str(body.mode),
      repos: Array.isArray(body.repos)
        ? body.repos.filter((r): r is string => typeof r === "string")
        : undefined,
      lang: str(body.lang),
    },
    auth.internal,
    impl,
    req.headers,
    cors,
  );
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function authorize(
  req: HttpApiRequest,
):
  | { ok: true; internal: boolean }
  | { ok: false; status: 401 | 500; error: string } {
  return decideWebhookAuth({
    secret: process.env.WEBHOOK_SECRET,
    providedCredential: extractWebhookCredential(req.headers),
    requireSecret: requireWebhookSecretFlag(),
    isProduction: isProductionRuntime(),
  });
}

function parseBodyJson(req: HttpApiRequest): Record<string, unknown> {
  if (req.bodyJson !== undefined) {
    if (req.bodyJson == null) return {};
    if (typeof req.bodyJson === "object") {
      return req.bodyJson as Record<string, unknown>;
    }
    throw new Error("invalid body");
  }
  const text = req.bodyText ?? "";
  return JSON.parse(text || "{}") as Record<string, unknown>;
}

async function respondGossip(
  intent: GossipIntent,
  internal: boolean,
  impl: {
    doGossip: typeof runGossip;
    doScore: typeof runScore;
    doCompare: typeof runCompare;
  },
  headers: HeaderBag,
  cors: Record<string, string>,
): Promise<HttpApiResponse> {
  const { doGossip, doScore, doCompare } = impl;
  const locale: ScoreLocale =
    (intent.lang ?? "").trim().toLowerCase() === "en" ? "en" : "zh";
  const normalizedMode = (intent.mode ?? "").trim().toLowerCase();
  const scoreMode = normalizedMode === "score";
  const compareMode = normalizedMode === "compare";

  const env = extractByokEnv(headers, {
    allowPrivateLlmBaseUrl:
      process.env.GOSSIP_ALLOW_PRIVATE_LLM_BASE_URL?.trim() === "1" ||
      process.env.GOSSIP_ALLOW_PRIVATE_LLM_BASE_URL?.trim().toLowerCase() ===
        "true",
  });
  const ttlSec = parsePositiveInt(process.env.GOSSIP_CACHE_TTL_SEC, 600);
  const normalizedFormat = intent.format.trim().toLowerCase() || "web";

  let repoKey: string;
  let compareList: string[] | null = null;

  if (compareMode) {
    // 对比模式:单个仓库失败应呈现为 N/A 列,因此不做硬校验;
    // 仅校验数量与格式规范(parseCompareRepos)。
    try {
      compareList = parseCompareRepos(
        intent.repos ?? (intent.repo ? [intent.repo] : []),
      );
    } catch (err) {
      return json(
        400,
        { error: err instanceof Error ? err.message : String(err) },
        cors,
      );
    }
    repoKey = compareList.join(",").toLowerCase();
  } else {
    try {
      const ref = parseRepoRef(intent.repo);
      repoKey = `${ref.owner}/${ref.repo}`.toLowerCase();
    } catch (err) {
      return json(
        400,
        { error: err instanceof Error ? err.message : String(err) },
        cors,
      );
    }
  }

  // Cache key carries the effective surface ("score"/"compare" vs tabloid format).
  const cacheFormat = scoreMode
    ? "score"
    : compareMode
      ? "compare"
      : normalizedFormat;
  const cacheKey = buildGossipCacheKey({
    repo: repoKey,
    days: intent.days,
    offline: intent.offline,
    format: cacheFormat,
    byokFingerprint: byokFingerprint(env),
    lang: locale,
    internal,
  });

  // Serve cache before consuming rate-limit budget (HIT is cheap).
  const cached = getGossipCache(cacheKey);
  if (cached) {
    return json(cached.status, cached.body, { ...cors, "X-Cache": "HIT" });
  }

  const limited = enforceRateLimits(headers, repoKey, internal);
  if (limited) {
    return json(limited.status, limited.payload, {
      ...cors,
      "Retry-After": String(limited.retryAfterSec),
    });
  }

  try {
    if (scoreMode) {
      const { score, message, missing } = await doScore({
        repo: intent.repo,
        env,
        locale,
      });
      const body = { kind: "score" as const, score, message, missing };
      setGossipCache(cacheKey, { status: 200, body }, ttlSec);
      return json(200, body, { ...cors, "X-Cache": "MISS" });
    }

    if (compareMode && compareList) {
      const { entries, message } = await doCompare({
        repos: compareList,
        env,
        locale,
      });
      const body = { kind: "compare" as const, entries, message };
      setGossipCache(cacheKey, { status: 200, body }, ttlSec);
      return json(200, body, { ...cors, "X-Cache": "MISS" });
    }

    const {
      tabloid,
      message,
      mode: gossipMode,
      llmError,
      warnings,
    } = await doGossip({
      repo: intent.repo,
      offline: intent.offline,
      sinceDays: intent.days,
      env,
    });

    let body: unknown;
    if (normalizedFormat === "json") {
      body = tabloid;
    } else if (normalizedFormat === "discord") {
      body = { embeds: [toDiscordEmbed(tabloid)] };
    } else if (normalizedFormat === "feishu") {
      body = toFeishuCard(tabloid);
    } else if (normalizedFormat === "markdown") {
      body = {
        markdown: message.markdown,
        plain: message.plain,
        // 实际执行模式(llm/offline/fallback),便于消费方识别降级。
        mode: gossipMode,
        llmError: sanitizeLlmError(llmError, internal || Boolean(env.LLM_API_KEY)),
        warnings,
      };
    } else {
      body = {
        tabloid,
        message,
        mode: gossipMode,
        // 服务端 Key 的上游 LLM 错误细节不外泄;BYOK/内部调用保留(用户排障需要)。
        llmError: sanitizeLlmError(llmError, internal || Boolean(env.LLM_API_KEY)),
        warnings,
      };
    }

    setGossipCache(cacheKey, { status: 200, body }, ttlSec);
    return json(200, body, { ...cors, "X-Cache": "MISS" });
  } catch (err) {
    return internalError(err, "api/gossip");
  }
}

/** 服务端 Key 模式下,上游 LLM 错误细节(状态码/响应体片段)不对公开客户端外泄。 */
function sanitizeLlmError(
  llmError: string | undefined,
  mayShowDetail: boolean,
): string | undefined {
  if (!llmError) return undefined;
  if (mayShowDetail) return llmError;
  return "LLM 暂不可用,已回落本地模板";
}

function enforceRateLimits(
  headers: HeaderBag,
  repoKey: string,
  internal: boolean,
): { status: 429; payload: unknown; retryAfterSec: number } | null {
  const ipLimit = parsePositiveInt(
    process.env.GOSSIP_RATE_LIMIT_IP_PER_HOUR,
    30,
  );
  const repoLimit = parsePositiveInt(
    process.env.GOSSIP_RATE_LIMIT_REPO_PER_HOUR,
    60,
  );

  if (!internal) {
    const ipResult = consumeRateLimit(
      "ip",
      clientIpFromHeaders(headers),
      ipLimit,
      WINDOW_MS,
    );
    if (!ipResult.ok) {
      return {
        status: 429,
        payload: {
          error: "rate limit exceeded (ip)",
          retryAfterSec: ipResult.retryAfterSec,
        },
        retryAfterSec: ipResult.retryAfterSec,
      };
    }
  }

  const repoResult = consumeRateLimit("repo", repoKey, repoLimit, WINDOW_MS);
  if (!repoResult.ok) {
    return {
      status: 429,
      payload: {
        error: "rate limit exceeded (repo)",
        retryAfterSec: repoResult.retryAfterSec,
      },
      retryAfterSec: repoResult.retryAfterSec,
    };
  }
  return null;
}

export type BadgeApiInput = {
  method: string;
  owner: unknown;
  repo: unknown;
  lang?: unknown;
  headers: HeaderBag;
};

/**
 * GET /api/badge/:owner/:repo.svg(或 .json —— shields.io endpoint 格式)
 * 含金量徽章:公开访问、永不破图 —— 仓库失败、限额、限流一律输出灰色 N/A(HTTP 200)。
 */
export async function handleBadgeApiRequest(
  input: BadgeApiInput,
  deps: BadgeApiDeps = {},
): Promise<HttpApiResponse> {
  const doScore = deps.runScore ?? runScore;

  if (input.method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const badgeReq = resolveBadgeRequest(input.owner, input.repo);
  if (!badgeReq) {
    return json(400, { error: "invalid badge repo path" });
  }
  const repoRef = `${badgeReq.owner}/${badgeReq.repo}`;

  const locale: ScoreLocale =
    typeof input.lang === "string" && input.lang.toLowerCase() === "en"
      ? "en"
      : "zh";

  // 与 gossip 路径同口径解析(0 = 关闭缓存),不再强制 ≥600s。
  const ttlSec = parsePositiveInt(process.env.GOSSIP_CACHE_TTL_SEC, 600);
  const cacheKey = buildGossipCacheKey({
    repo: repoRef,
    days: 0,
    offline: true,
    format: `badge-${badgeReq.format}`,
    byokFingerprint: "",
    lang: locale,
    internal: false,
  });

  const baseHeaders: Record<string, string> =
    badgeReq.format === "json"
      ? {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
        }
      : {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
        };

  const cached = getGossipCache(cacheKey);
  if (cached) {
    return {
      status: 200,
      headers: { ...baseHeaders, "X-Cache": "HIT" },
      body: String(cached.body),
    };
  }

  // 徽章每次缓存未命中要打 11-15 次 GitHub API:对单 IP 限流,防枚举烧配额。
  const badgeLimit = parsePositiveInt(
    process.env.GOSSIP_RATE_LIMIT_BADGE_PER_HOUR,
    60,
  );
  const ipResult = consumeRateLimit(
    "badge-ip",
    clientIpFromHeaders(input.headers),
    badgeLimit,
    WINDOW_MS,
  );
  if (!ipResult.ok) {
    // 限流不破图:200 + 灰色 N/A;no-store 防止 CDN 把 N/A 缓存一小时毒化真徽章。
    return {
      status: 200,
      headers: {
        ...baseHeaders,
        "Cache-Control": "no-store",
        "Retry-After": String(ipResult.retryAfterSec),
        "X-Cache": "RATE-LIMITED",
      },
      body:
        badgeReq.format === "json"
          ? badgeEndpointError(locale)
          : badgeErrorSvg(locale),
    };
  }

  try {
    const { score } = await doScore({ repo: repoRef, locale });
    const body =
      badgeReq.format === "json"
        ? formatBadgeEndpoint(score, locale)
        : formatBadgeSvg(score, locale);
    setGossipCache(cacheKey, { status: 200, body }, ttlSec);
    return {
      status: 200,
      headers: { ...baseHeaders, "X-Cache": "MISS" },
      body,
    };
  } catch {
    // 仓库不存在 / 限额 / 网络失败 —— 一律灰色 N/A,不破图。
    // no-store:与限流分支同口径,防 CDN 把瞬时失败缓存一小时毒化真徽章。
    return {
      status: 200,
      headers: {
        ...baseHeaders,
        "Cache-Control": "no-store",
        "X-Cache": "BYPASS",
      },
      body:
        badgeReq.format === "json"
          ? badgeEndpointError(locale)
          : badgeErrorSvg(locale),
    };
  }
}
