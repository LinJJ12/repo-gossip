import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  runGossip,
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
} from "../packages/core/src/index.js";
import {
  authorizeGossip,
  applyGossipCors,
  clientIp,
} from "./_auth.js";

type GossipBody = {
  repo?: string;
  offline?: boolean;
  format?: string;
  days?: number;
};

const WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/gossip
 * body: { "repo": "owner/repo", "offline"?: boolean, "days"?: number, "format"?: "markdown"|"json"|"discord"|"feishu"|"web" }
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
    if (!repo) {
      res.status(200).json({
        ok: true,
        usage:
          'GET /api/gossip?repo=owner/repo or POST {"repo":"owner/repo","format":"web"}',
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

  if (!body.repo || typeof body.repo !== "string") {
    res.status(400).json({ error: "missing repo" });
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
    body.repo,
    Boolean(body.offline),
    typeof body.format === "string" ? body.format : "web",
    days,
    auth.internal,
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
) {
  let repoKey: string;
  try {
    const ref = parseRepoRef(repo);
    repoKey = `${ref.owner}/${ref.repo}`.toLowerCase();
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const env = extractByokEnv(
    req.headers as Record<string, string | string[] | undefined>,
  );
  const ttlSec = parsePositiveInt(process.env.GOSSIP_CACHE_TTL_SEC, 600);
  const normalizedFormat = format.trim().toLowerCase() || "web";
  const cacheKey = buildGossipCacheKey({
    repo: repoKey,
    days,
    offline,
    format: normalizedFormat,
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
    const { tabloid, message, mode, llmError, warnings } = await runGossip({
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
      body = { tabloid, message, mode, llmError, warnings };
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
