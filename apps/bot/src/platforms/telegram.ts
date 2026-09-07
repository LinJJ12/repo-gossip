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
      "把 GitHub 仓库丢给我，我给你整一份「项目八卦小报」。\n\n用法：\n/gossip owner/repo\n/gossip owner/repo 7\n/gossip owner/repo --offline\n或直接发 GitHub 链接",
    );
  });

  bot.command("gossip", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const arg = text.replace(/^\/gossip(@\w+)?\s*/i, "").trim();
    const parsed = parseGossipArgs(arg, options?.offline);
    if (!parsed) {
      await ctx.reply(
        "请附上仓库，例如：/gossip vercel/next.js 或 /gossip vercel/next.js 7 --offline",
      );
      return;
    }
    await replyGossip(ctx, parsed.repo, parsed.offline, parsed.days);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const match = ctx.message.text.match(REPO_RE);
    if (!match) return;
    await replyGossip(ctx, match[1]!, options?.offline ?? false, 14);
  });

  return bot;
}

export function parseGossipArgs(
  arg: string,
  defaultOffline = false,
): { repo: string; days: number; offline: boolean } | null {
  const offline = /\s--offline\b/i.test(arg) || defaultOffline;
  const cleaned = arg.replace(/\s--offline\b/i, "").trim();
  const match = cleaned.match(REPO_RE);
  if (!match) return null;
  const rest = cleaned.slice(match[0].length).trim();
  const daysMatch = rest.match(/^(\d{1,2})\b/);
  let days = 14;
  if (daysMatch) {
    const n = Number(daysMatch[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 90) days = n;
  }
  return { repo: match[1]!, days, offline };
}

async function replyGossip(
  ctx: { reply: (text: string, other?: object) => Promise<unknown> },
  repo: string,
  offline: boolean,
  days: number,
) {
  await ctx.reply(`📡 正在偷看 ${repo} 的提交簿…`);
  try {
    const { message, mode, llmError, warnings } = await runGossip({
      repo,
      offline,
      sinceDays: days,
    });
    const keyboard = new InlineKeyboard().url(
      "打开仓库",
      `https://github.com/${repo.replace(/\.git$/i, "")}`,
    );
    const notes = [
      mode !== "llm" ? `[mode=${mode}]` : null,
      llmError,
      ...(warnings ?? []),
    ]
      .filter(Boolean)
      .join("\n");
    await ctx.reply(
      `${notes ? `${notes}\n\n` : ""}${message.plain.slice(0, 3500)}`,
      {
        reply_markup: keyboard,
      },
    );
  } catch (err) {
    await ctx.reply(
      `八卦失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
