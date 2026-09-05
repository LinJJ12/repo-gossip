import { Bot, InlineKeyboard } from "grammy";
import { runGossip } from "@repo-gossip/core";

const REPO_RE =
  /(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/;

export function createTelegramBot(
  token: string,
  options?: { offline?: boolean },
) {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "把 GitHub 仓库丢给我，我给你整一份「项目八卦小报」。\n\n用法：\n/gossip owner/repo\n/gossip https://github.com/owner/repo",
    );
  });

  bot.command("gossip", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const arg = text.replace(/^\/gossip(@\w+)?\s*/i, "").trim();
    const match = arg.match(REPO_RE);
    if (!match) {
      await ctx.reply("请附上仓库，例如：/gossip vercel/next.js");
      return;
    }
    await replyGossip(ctx, match[1]!, options?.offline);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const match = ctx.message.text.match(REPO_RE);
    if (!match) return;
    await replyGossip(ctx, match[1]!, options?.offline);
  });

  return bot;
}

async function replyGossip(
  ctx: { reply: (text: string, other?: object) => Promise<unknown> },
  repo: string,
  offline?: boolean,
) {
  await ctx.reply(`📡 正在偷看 ${repo} 的提交簿…`);
  try {
    const { message } = await runGossip({ repo, offline });
    const keyboard = new InlineKeyboard().url(
      "打开仓库",
      `https://github.com/${repo.replace(/\.git$/i, "")}`,
    );
    await ctx.reply(message.plain.slice(0, 4000), {
      reply_markup: keyboard,
    });
  } catch (err) {
    await ctx.reply(
      `八卦失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
