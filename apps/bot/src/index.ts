#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { startDiscordBot } from "./platforms/discord.js";
import { createTelegramBot } from "./platforms/telegram.js";

loadDotenv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
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
    void bot.start();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
