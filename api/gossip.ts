import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  runGossip,
  runScore,
  runCompare,
  parseCompareRepos,
  toDiscordEmbed,
  toFeishuCard,
  extractByokEnv,
  consumeRateLimit,
  parsePositiveInt,
  clampGossipDays,
  buildGossipCacheKey,
  byokFingerprint,
  getGossipCache,
  setGossipCache,
  parseRepoRef,
  type ScoreLocale,
} from "../packages/core/src/index.js";
import {
  authorizeGossip,
  applyGossipCors,
  clientIp,
} from "./_auth.js";

type GossipBody = {
  repo?: string;
  /** mode=compare 时的仓库列表(2-4 个);也可用 repo 逗号分隔。 */
  repos?: string[];
  offline?: boolean;
  format?: string;
  days?: number;
  /** "score" → 含金量评分卡;"compare" → 多仓库对比;缺省 → 八卦小报。 */
  mode?: string;
  /** 评分/对比输出语言(默认 zh)。 */
  lang?: string;
};

const WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/gossip
 * body: { "repo": "owner/repo", "offline"?: boolean, "days"?: number, "format"?: "markdown"|"json"|"discord"|"feishu"|"web", "mode"?: "score"|"compare", "repos"?: string[], "lang"?: "zh"|"en" }
 *
 * mode "score" → 含金量评分卡 { kind:"score", score, message, missing }。
 * mode "compare" → 多仓库对比 { kind:"compare", entries, message }(repos 2-4 个,单个失败呈现为 N/A 列)。
 * lang "en" → 评分/对比文案切换英文(默认 zh)。
 *
 * Public by default (no WEBHOOK_SECRET required). Optional internal auth via
 * Authorization: Bearer / x-webhook-secret. Kill-switch: GOSSIP_REQUIRE_WEBHOOK_SECRET=1.
 * BYOK: x-github-token, x-llm-api-key, x-llm-base-url, x-llm-model → runGossip({ env }).
 * Rate limit + short TTL cache (in-memory). Health GET without ?repo= stays open.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyGossipCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    const repo = typeof req.query.repo === "string" ? req.query.repo : "";
    const hasQueryRepos =
      typeof req.query.repos === "string" || Array.isArray(req.query.repos);
    const isCompareQuery = req.query.mode === "compare" && hasQueryRepos;
    if (!repo && !isCompareQuery) {
      res.status(200).json({
        ok: true,
        usage:
          'GET /api/gossip?repo=owner/repo or POST {"repo":"owner/repo","format":"web"}; score: {"mode":"score"}; compare: {"mode":"compare","repos":["a/b","c/d"]}',
      });
      return;
    }
    const auth = authorizeGossip(req, res);
    if (!auth.ok) return;
    const days = clampGossipDays(Number(req.query.days ?? "14"));
    return respond(
      req,
      res,
      repo,
      req.query.offline === "1",
      String(req.query.format ?? "web"),
      days,
      auth.internal,
      typeof req.query.mode === "string" ? req.query.mode : undefined,
      typeof req.query.repos === "string"
        ? req.query.repos
        : Array.isArray(req.query.repos)
          ? req.query.repos.filter((r): r is string => typeof r === "string")
          : undefined,
      typeof req.query.lang === "string" ? req.query.lang : undefined,
    );
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = authorizeGossip(req, res);
  if (!auth.ok) return;

  let body: GossipBody;
  try {
    body = parseBody(req.body);
  } catch {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }

  const normalizedMode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "";
  const hasRepos =
    (Array.isArray(body.repos) && body.repos.length > 0) ||
    (typeof body.repo === "string" && body.repo.includes(","));
  if (normalizedMode !== "compare" && (!body.repo || typeof body.repo !== "string")) {
    res.status(400).json({ error: "missing repo" });
    return;
  }
  if (normalizedMode === "compare" && !hasRepos) {
    res.status(400).json({
      error: 'compare needs repos, e.g. {"mode":"compare","repos":["owner/a","owner/b"]}',
    });
    return;
  }

  const days = clampGossipDays(
    typeof body.days === "number" && Number.isFinite(body.days)
      ? body.days
      : 14,
  );

  return respond(
    req,
    res,
    body.repo ?? "",
    Boolean(body.offline),
    typeof body.format === "string" ? body.format : "web",
    days,
    auth.internal,
    typeof body.mode === "string" ? body.mode : undefined,
    Array.isArray(body.repos)
      ? body.repos.filter((r): r is string => typeof r === "string")
      : undefined,
    typeof body.lang === "string" ? body.lang : undefined,
  );
}

function parseBody(raw: unknown): GossipBody {
  if (raw == null) return {};
  if (typeof raw === "string") {
    return JSON.parse(raw || "{}") as GossipBody;
  }
  if (typeof raw === "object") {
    return raw as GossipBody;
  }
  throw new Error("invalid body");
}

function enforceRateLimits(
  res: VercelResponse,
  ip: string,
  repoKey: string,
  internal: boolean,
): boolean {
  const ipLimit = parsePositiveInt(
    process.env.GOSSIP_RATE_LIMIT_IP_PER_HOUR,
    30,
  );
  const repoLimit = parsePositiveInt(
    process.env.GOSSIP_RATE_LIMIT_REPO_PER_HOUR,
    60,
  );

  if (!internal) {
    const ipResult = consumeRateLimit("ip", ip, ipLimit, WINDOW_MS);
    if (!ipResult.ok) {
      res.setHeader("Retry-After", String(ipResult.retryAfterSec));
      res.status(429).json({
        error: "rate limit exceeded (ip)",
        retryAfterSec: ipResult.retryAfterSec,
      });
      return false;
    }
  }

  const repoResult = consumeRateLimit("repo", repoKey, repoLimit, WINDOW_MS);
  if (!repoResult.ok) {
    res.setHeader("Retry-After", String(repoResult.retryAfterSec));
    res.status(429).json({
      error: "rate limit exceeded (repo)",
      retryAfterSec: repoResult.retryAfterSec,
    });
    return false;
  }
  return true;
}

async function respond(
  req: VercelRequest,
  res: VercelResponse,
  repo: string,
  offline: boolean,
  format: string,
  days: number,
  internal: boolean,
  mode?: string,
  repos?: string | string[],
  lang?: string,
) {
  const locale: ScoreLocale = (lang ?? "").trim().toLowerCase() === "en" ? "en" : "zh";
  const normalizedMode = (mode ?? "").trim().toLowerCase();
  const scoreMode = normalizedMode === "score";
  const compareMode = normalizedMode === "compare";

  const env = extractByokEnv(
    req.headers as Record<string, string | string[] | undefined>,
  );
  const ttlSec = parsePositiveInt(process.env.GOSSIP_CACHE_TTL_SEC, 600);
  const normalizedFormat = format.trim().toLowerCase() || "web";

  let repoKey: string;
  let compareList: string[] | null = null;

  if (compareMode) {
    // 对比模式:单个仓库失败应呈现为 N/A 列,因此不做硬校验;
    // 仅校验数量与格式规范(parseCompareRepos)。
    try {
      compareList = parseCompareRepos(repos ?? (repo ? [repo] : []));
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    repoKey = compareList.join(",").toLowerCase();
  } else {
    try {
      const ref = parseRepoRef(repo);
      repoKey = `${ref.owner}/${ref.repo}`.toLowerCase();
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  // Cache key carries the effective surface ("score"/"compare" vs tabloid format).
  const cacheFormat = scoreMode ? "score" : compareMode ? "compare" : normalizedFormat;
  const cacheKey = buildGossipCacheKey({
    repo: repoKey,
    days,
    offline,
    format: cacheFormat,
    byokFingerprint: byokFingerprint(env),
  });

  // Serve cache before consuming rate-limit budget (HIT is cheap).
  const cached = getGossipCache(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.status(cached.status).json(cached.body);
    return;
  }

  if (!enforceRateLimits(res, clientIp(req), repoKey, internal)) return;

  try {
    if (scoreMode) {
      const { score, message, missing } = await runScore({ repo, env, locale });
      const body = { kind: "score" as const, score, message, missing };
      setGossipCache(cacheKey, { status: 200, body }, ttlSec);
      res.setHeader("X-Cache", "MISS");
      res.status(200).json(body);
      return;
    }

    if (compareMode && compareList) {
      const { entries, message } = await runCompare({
        repos: compareList,
        env,
        locale,
      });
      const body = { kind: "compare" as const, entries, message };
      setGossipCache(cacheKey, { status: 200, body }, ttlSec);
      res.setHeader("X-Cache", "MISS");
      res.status(200).json(body);
      return;
    }

    const { tabloid, message, mode: gossipMode, llmError, warnings } = await runGossip({
      repo,
      offline,
      sinceDays: days,
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
        mode,
        llmError,
        warnings,
      };
    } else {
      body = { tabloid, message, mode: gossipMode, llmError, warnings };
    }

    setGossipCache(cacheKey, { status: 200, body }, ttlSec);
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(body);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
