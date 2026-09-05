import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Returns true if request is authorized (or no secret configured in non-production). */
export function assertWebhookAuth(
  req: VercelRequest,
  res: VercelResponse,
): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  const isProd =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      res.status(500).json({
        error: "WEBHOOK_SECRET is required in production",
      });
      return false;
    }
    return true;
  }

  const header =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    req.headers["x-webhook-secret"];

  if (header !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

export function isProductionRuntime() {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}
