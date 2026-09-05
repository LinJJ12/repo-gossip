/**
 * Discord Interactions endpoint is not fully implemented.
 * Use the long-running bot: npm run bot
 *
 * This stub refuses forged/unsigned traffic (no signature verification yet).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      hint: "Use npm run bot with DISCORD_BOT_TOKEN. Interactions webhook is not ready.",
    });
    return;
  }

  // Refuse until Ed25519 verification is implemented — do not ACK Discord PING.
  res.status(501).json({
    error:
      "Discord Interactions webhook not implemented. Run: DISCORD_BOT_TOKEN=xxx npm run bot",
  });
}
