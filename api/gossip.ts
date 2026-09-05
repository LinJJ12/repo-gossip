import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  runGossip,
  toDiscordEmbed,
  toFeishuCard,
} from "../packages/core/src/index.js";

type GossipBody = {
  repo?: string;
  offline?: boolean;
  format?: string;
  days?: number;
};

/**
 * POST /api/gossip
 * body: { "repo": "owner/repo", "offline"?: boolean, "days"?: number, "format"?: "markdown"|"json"|"discord"|"feishu"|"web" }
 *
 * If WEBHOOK_SECRET is set, require Authorization: Bearer <secret> or x-webhook-secret.
 * Health GET without ?repo= stays open.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    if (!authorize(req, res)) return;
    const days = Number(req.query.days ?? "14");
    return respond(
      res,
      repo,
      req.query.offline === "1",
      String(req.query.format ?? "web"),
      Number.isFinite(days) ? days : 14,
    );
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!authorize(req, res)) return;

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

  const days =
    typeof body.days === "number" && Number.isFinite(body.days)
      ? body.days
      : 14;

  return respond(
    res,
    body.repo,
    Boolean(body.offline),
    typeof body.format === "string" ? body.format : "web",
    days,
  );
}

function authorize(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      res.status(500).json({
        error: "WEBHOOK_SECRET is required in production",
      });
      return false;
    }
    return true;
  }

  const header =
    (typeof req.headers.authorization === "string" &&
      req.headers.authorization.replace(/^Bearer\s+/i, "")) ||
    req.headers["x-webhook-secret"];

  if (header !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
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

async function respond(
  res: VercelResponse,
  repo: string,
  offline: boolean,
  format: string,
  days: number,
) {
  try {
    const { tabloid, message, mode, llmError } = await runGossip({
      repo,
      offline,
      sinceDays: days,
    });

    if (format === "json") {
      res.status(200).json(tabloid);
      return;
    }
    if (format === "discord") {
      res.status(200).json({ embeds: [toDiscordEmbed(tabloid)] });
      return;
    }
    if (format === "feishu") {
      res.status(200).json(toFeishuCard(tabloid));
      return;
    }
    if (format === "markdown") {
      res.status(200).json({
        markdown: message.markdown,
        plain: message.plain,
        mode,
        llmError,
      });
      return;
    }

    res.status(200).json({ tabloid, message, mode, llmError });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
