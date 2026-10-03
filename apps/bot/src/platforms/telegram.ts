import { Bot, InlineKeyboard } from "grammy";
import {
  LOOSE_REPO_PATTERN,
  llmDegradedNote,
  matchLooseRepo,
  missingSignalLabel,
  parseCompareRepos,
  runCompare,
  runGossip,
  runScore,
} from "@repo-gossip/core";
import { busyReplyText, consumeBotUserLimit } from "../rate-guard.js";

const MAX_TELEGRAM_TEXT = 3500;

// Telegram webhook/轮询都是 at-least-once:平台超时重投会重跑完整管线。
// 进程内按 chat:message 去重,保留最近 500 条覆盖重投窗口。
const seenDeliveryKeys = new Set<string>();
const SEEN_DELIVERY_KEYS_MAX = 500;

export function createTelegramBot(
  token: string,
  options?: { offline?: boolean },
) {
  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    const messageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;
    if (messageId != null && chatId != null) {
      const key = `${chatId}:${messageId}`;
      if (seenDeliveryKeys.has(key)) return; // 重复投递,丢弃
      seenDeliveryKeys.add(key);
      if (seenDeliveryKeys.size > SEEN_DELIVERY_KEYS_MAX) {
        for (const k of seenDeliveryKeys) {
          seenDeliveryKeys.delete(k);
          if (seenDeliveryKeys.size <= SEEN_DELIVERY_KEYS_MAX / 2) break;
        }
      }
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "把 GitHub 仓库丢给我,我给你整一份「项目八卦小报」或「含金量检定报告」。\n\n" +
        "用法:\n" +
        "/gossip owner/repo — 八卦小报(可加天数与 --offline)\n" +
        "/score owner/repo — 含金量检定\n" +
        "/compare owner/a owner/b — 多仓对比(2-4 个)\n" +
        "或直接发 GitHub 链接",
    );
  });

  bot.command("gossip", async (ctx) => {
    const guard = guardUser(ctx);
    if (!guard) return;
    const arg = stripCommand(ctx.message?.text ?? "");
    const parsed = parseGossipArgs(arg, options?.offline);
    if (!parsed) {
      await ctx.reply(
        "请附上仓库,例如:/gossip vercel/next.js 或 /gossip vercel/next.js 7 --offline",
      );
      return;
    }
    await replyGossip(ctx, parsed.repo, parsed.offline, parsed.days);
  });

  bot.command("score", async (ctx) => {
    const guard = guardUser(ctx);
    if (!guard) return;
    const repo = matchLooseRepo(stripCommand(ctx.message?.text ?? ""));
    if (!repo) {
      await ctx.reply("请附上仓库,例如:/score vercel/next.js");
      return;
    }
    await replyScore(ctx, repo);
  });

  bot.command("compare", async (ctx) => {
    const guard = guardUser(ctx);
    if (!guard) return;
    const arg = stripCommand(ctx.message?.text ?? "");
    let repos: string[];
    try {
      repos = parseCompareRepos(arg);
    } catch (err) {
      await ctx.reply(
        `${err instanceof Error ? err.message : String(err)}\n示例:/compare vercel/next.js sindresorhus/is`,
      );
      return;
    }
    await replyCompare(ctx, repos);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const guard = guardUser(ctx);
    if (!guard) return;
    const repo = matchLooseRepo(ctx.message.text);
    if (!repo) return;
    await replyGossip(ctx, repo, options?.offline ?? false, 14);
  });

  return bot;
}

function stripCommand(text: string): string {
  return text.replace(/^\/\w+(@\w+)?\s*/i, "").trim();
}

/** 每用户限流;超限回复提示并返回 null。 */
function guardUser(ctx: {
  from?: { id?: number };
  reply: (text: string, other?: object) => Promise<unknown>;
}): boolean {
  const userId = ctx.from?.id != null ? String(ctx.from.id) : "unknown";
  const guard = consumeBotUserLimit(userId);
  if (!guard.ok) {
    // 不能 fire-and-forget:Telegram API 失败会变成未处理拒绝杀死常驻进程。
    ctx.reply(busyReplyText(guard.retryAfterSec)).catch(() => {});
    return false;
  }
  return true;
}

export function parseGossipArgs(
  arg: string,
  defaultOffline = false,
): { repo: string; days: number; offline: boolean } | null {
  const offline = /\s--offline\b/i.test(arg) || defaultOffline;
  const cleaned = arg.replace(/\s--offline\b/i, "").trim();
  const m = cleaned.match(LOOSE_REPO_PATTERN);
  if (!m) return null;
  const repo = `${m[1]}/${m[2].replace(/\.+$/, "")}`;
  // 用正则命中的结束位置切尾参,避免 repo 字符串在文本里更早出现时错切。
  const rest = cleaned.slice(m.index! + m[0].length).trim();
  const daysMatch = rest.match(/^(\d{1,2})\b/);
  let days = 14;
  if (daysMatch) {
    const n = Number(daysMatch[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 90) days = n;
  }
  return { repo, days, offline };
}

type ReplyCtx = { reply: (text: string, other?: object) => Promise<unknown> };

async function replyGossip(
  ctx: ReplyCtx,
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
      llmDegradedNote(llmError),
      ...(warnings ?? []),
    ]
      .filter(Boolean)
      .join("\n");
    await ctx.reply(
      `${notes ? `${notes}\n\n` : ""}${message.plain.slice(0, MAX_TELEGRAM_TEXT)}`,
      {
        reply_markup: keyboard,
      },
    );
  } catch (err) {
    await ctx.reply(
      `八卦失败:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function replyScore(ctx: ReplyCtx, repo: string) {
  await ctx.reply(`🧪 正在检定 ${repo} 的含金量…`);
  try {
    const { message, missing } = await runScore({ repo });
    await ctx.reply(message.plain.slice(0, MAX_TELEGRAM_TEXT));
    if (missing.length > 0) {
      await ctx.reply(
        `⚠️ 缺失信号:${missing.map((id) => missingSignalLabel(id)).join("、")}(置信度已降权)`,
      );
    }
  } catch (err) {
    await ctx.reply(
      `验金失败:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function replyCompare(ctx: ReplyCtx, repos: string[]) {
  await ctx.reply(`⚖️ 正在对比 ${repos.join(" vs ")}…`);
  try {
    const { message } = await runCompare({ repos });
    await ctx.reply(message.plain.slice(0, MAX_TELEGRAM_TEXT));
  } catch (err) {
    await ctx.reply(
      `对比失败:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
