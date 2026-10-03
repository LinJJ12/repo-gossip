import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Bot, webhookCallback } from "grammy";
import { secretEqual } from "../packages/core/src/index.js";
import { createTelegramBot } from "../apps/bot/src/platforms/telegram.js";

let bot: Bot | null = null;

function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("missing TELEGRAM_BOT_TOKEN");
  if (!bot) {
    bot = createTelegramBot(token, {
      offline: process.env.GOSSIP_OFFLINE === "1",
    });
  }
  return bot;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const isProd = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");

    if (isProd && !secret) {
      res.status(500).json({
        error: "TELEGRAM_WEBHOOK_SECRET is required in production",
      });
      return;
    }

    if (secret) {
      const header = req.headers["x-telegram-bot-api-secret-token"];
      const provided = Array.isArray(header) ? header[0] : header;
      if (typeof provided !== "string" || !secretEqual(provided, secret)) {
        res.status(401).json({ error: "invalid telegram secret" });
        return;
      }
    }

    // grammy webhook 默认 10s 超时且超时即 throw:与 LLM 20s 管线冲突,还会对
    // 已写回的响应再写 500。这里放宽到 30s;超时后 handler.end() 回空 200,
    // 响应由业务经 API 主动回复,Telegram 重投由进程内 message 去重兜底。
    const handle = webhookCallback(getBot(), "https", {
      timeoutMilliseconds: 30_000,
      onTimeout: "return",
    });
    await handle(req, res);
  } catch (err) {
    // 与 core http-api 同口径:500 统一脱敏,细节只进服务端日志。
    console.error("[api/telegram] internal error:", err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: "internal error" });
  }
}
