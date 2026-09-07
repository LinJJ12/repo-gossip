import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  decideWebhookAuth,
  extractWebhookCredential,
  resolveCorsAllowOrigin,
  GOSSIP_CORS_ALLOW_HEADERS,
  GOSSIP_CORS_ALLOW_METHODS,
} from "../packages/core/src/index.js";

export function isProductionRuntime() {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function requireWebhookSecretFlag(): boolean {
  const raw = process.env.GOSSIP_REQUIRE_WEBHOOK_SECRET?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

export type GossipAuthOk = { ok: true; internal: boolean };
export type GossipAuthFail = { ok: false };

/**
 * Public-by-default gossip auth.
 * Kill-switch: GOSSIP_REQUIRE_WEBHOOK_SECRET=1 restores production-required secret.
 * Wrong Bearer / x-webhook-secret when WEBHOOK_SECRET is set → 401.
 */
export function authorizeGossip(
  req: VercelRequest,
  res: VercelResponse,
): GossipAuthOk | GossipAuthFail {
  const decision = decideWebhookAuth({
    secret: process.env.WEBHOOK_SECRET,
    providedCredential: extractWebhookCredential(
      req.headers as Record<string, string | string[] | undefined>,
    ),
    requireSecret: requireWebhookSecretFlag(),
    isProduction: isProductionRuntime(),
  });

  if (!decision.ok) {
    res.status(decision.status).json({ error: decision.error });
    return { ok: false };
  }
  return { ok: true, internal: decision.internal };
}

/** @deprecated Prefer authorizeGossip when internal flag is needed. */
export function assertWebhookAuth(
  req: VercelRequest,
  res: VercelResponse,
): boolean {
  return authorizeGossip(req, res).ok;
}

/** Apply CORS headers for /api/gossip (and OPTIONS preflight). */
export function applyGossipCors(
  req: VercelRequest,
  res: VercelResponse,
): void {
  const origin = Array.isArray(req.headers.origin)
    ? req.headers.origin[0]
    : req.headers.origin;
  const allowOrigin = resolveCorsAllowOrigin(
    origin,
    process.env.GOSSIP_CORS_ORIGINS,
  );
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", GOSSIP_CORS_ALLOW_METHODS);
  res.setHeader("Access-Control-Allow-Headers", GOSSIP_CORS_ALLOW_HEADERS);
  if (allowOrigin !== "*") {
    res.setHeader("Vary", "Origin");
  }
}

export function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  const realIp = req.headers["x-real-ip"];
  const real = Array.isArray(realIp) ? realIp[0] : realIp;
  if (typeof real === "string" && real.trim()) return real.trim();
  return "unknown";
}
