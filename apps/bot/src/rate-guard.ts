import { consumeRateLimit, parsePositiveInt } from "@repo-gossip/core";

const WINDOW_MS = 10 * 60 * 1000;

/**
 * Bot 命令的每用户轻量限流(进程内固定窗口)。
 * 与 Web/API 的限流一致是尽力而为:多实例部署时各实例独立计数。
 * GOSSIP_BOT_USER_RATE_LIMIT 可覆盖(每 10 分钟次数,默认 12;0 = 不限)。
 */
export function consumeBotUserLimit(
  userId: string,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const limit = parsePositiveInt(
    process.env.GOSSIP_BOT_USER_RATE_LIMIT,
    12,
  );
  const result = consumeRateLimit("bot-user", userId, limit, WINDOW_MS);
  return result.ok
    ? { ok: true }
    : { ok: false, retryAfterSec: result.retryAfterSec };
}

export function busyReplyText(retryAfterSec: number): string {
  const min = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `⏳ 操作太频繁,请约 ${min} 分钟后再试。`;
}
