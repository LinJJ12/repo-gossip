#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { startDiscordBot } from "./platforms/discord.js";
import { createTelegramBot } from "./platforms/telegram.js";

loadDotenv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

// 常驻进程兜底:聊天机器人场景下,单次回调内的意外 rejection 不应直接杀死进程。
// unhandledRejection 记录后继续;uncaughtException 状态已不可信,退出交给编排层重启。
process.on("unhandledRejection", (reason) => {
  console.error("[bot] unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[bot] uncaught exception:", err);
  process.exit(1);
});

/**
 * 长连接模式：适合本地 / Railway / 常驻进程。
 * Vercel Serverless 请用根目录 /api/* webhook。
 */
async function main() {
  const offline =
    process.argv.includes("--offline") ||
    process.env.GOSSIP_OFFLINE === "1";
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!discordToken && !telegramToken) {
    console.error(
      "请设置 DISCORD_BOT_TOKEN 和/或 TELEGRAM_BOT_TOKEN，或使用：npm run gossip -- owner/repo",
    );
    process.exit(1);
  }

  if (discordToken) {
    await startDiscordBot(discordToken, { offline });
  }
  if (telegramToken) {
    const bot = createTelegramBot(telegramToken, { offline });
    console.log("Telegram Bot 开始轮询…");
    // bot.start 在轮询异常/断连结束时 reject,不能静默吞掉。
    // Discord websocket 会维持事件循环,只设 exitCode 的话进程永不退出,
    // Telegram 会"健康地"死掉 —— 直接退出交给编排层重启。
    bot.start().catch((err) => {
      console.error("Telegram Bot 轮询异常退出:", err);
      process.exit(1);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
