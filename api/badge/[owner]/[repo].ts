import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  runScore,
  formatBadgeSvg,
  badgeErrorSvg,
  resolveBadgeRepoParam,
  buildGossipCacheKey,
  getGossipCache,
  setGossipCache,
} from "../../../packages/core/src/index.js";

/**
 * GET /api/badge/:owner/:repo.svg
 *
 * 含金量徽章(嵌入 README 用):缓存优先,公开访问,无需 WEBHOOK_SECRET。
 * 任何失败(仓库不存在 / 限额 / 解析错误)都输出灰色 N/A 徽章且 HTTP 200,
 * 保证 README 永远不破图。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const repoRef = resolveBadgeRepoParam(req.query.owner, req.query.repo);
  if (!repoRef) {
    res.status(400).json({ error: "invalid badge repo path" });
    return;
  }

  const locale: "zh" | "en" =
    typeof req.query.lang === "string" && req.query.lang.toLowerCase() === "en"
      ? "en"
      : "zh";

  const ttlSec = Number(process.env.GOSSIP_CACHE_TTL_SEC) || 600;
  const cacheKey = buildGossipCacheKey({
    repo: `${locale}|${repoRef}`,
    days: 0,
    offline: true,
    format: "badge",
    byokFingerprint: "",
  });

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");

  const cached = getGossipCache(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).send(String(cached.body));
    return;
  }

  try {
    const { score } = await runScore({ repo: repoRef, locale });
    const svg = formatBadgeSvg(score, locale);
    setGossipCache(cacheKey, { status: 200, body: svg }, Math.max(ttlSec, 600));
    res.setHeader("X-Cache", "MISS");
    res.status(200).send(svg);
  } catch {
    // 仓库不存在 / 限额 / 网络失败 —— 一律灰色 N/A,不破图。
    res.setHeader("X-Cache", "BYPASS");
    res.status(200).send(badgeErrorSvg(locale));
  }
}
