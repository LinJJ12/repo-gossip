import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Bot, webhookCallback } from "grammy";
import { createTelegramBot } from "../src/platforms/telegram.js";

let bot: Bot | null = null;

function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("缺少 TELEGRAM_BOT_TOKEN");
  if (!bot) {
    bot = createTelegramBot(token, {
      offline: process.env.GOSSIP_OFFLINE === "1",
    });
  }
  return bot;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const handle = webhookCallback(getBot(), "https");
    await handle(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
