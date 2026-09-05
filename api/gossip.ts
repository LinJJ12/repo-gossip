import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runGossip } from "../src/core/gossip.js";
import { toDiscordEmbed, toFeishuCard } from "../src/core/format.js";

/**
 * POST /api/gossip
 * body: { "repo": "owner/repo", "offline"?: boolean, "format"?: "markdown"|"json"|"discord"|"feishu" }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const repo = typeof req.query.repo === "string" ? req.query.repo : "";
    if (!repo) {
      res.status(200).json({
        ok: true,
        usage: 'GET /api/gossip?repo=owner/repo or POST {"repo":"owner/repo"}',
      });
      return;
    }
    return respond(res, repo, req.query.offline === "1", String(req.query.format ?? "markdown"));
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as {
    repo?: string;
    offline?: boolean;
    format?: string;
  };
  if (!body?.repo) {
    res.status(400).json({ error: "缺少 repo 字段" });
    return;
  }

  return respond(res, body.repo, Boolean(body.offline), body.format ?? "markdown");
}

async function respond(
  res: VercelResponse,
  repo: string,
  offline: boolean,
  format: string,
) {
  try {
    const { tabloid, message } = await runGossip({ repo, offline });
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
    res.status(200).json({ markdown: message.markdown, plain: message.plain });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
