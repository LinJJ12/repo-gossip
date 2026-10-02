import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { busyReplyText, consumeBotUserLimit } from "../apps/bot/src/rate-guard.js";
import { resetRateLimitStores } from "../packages/core/src/rate-limit.js";

beforeEach(() => {
  delete process.env.GOSSIP_BOT_USER_RATE_LIMIT;
  resetRateLimitStores();
});

afterEach(() => {
  delete process.env.GOSSIP_BOT_USER_RATE_LIMIT;
  resetRateLimitStores();
});

describe("consumeBotUserLimit", () => {
  it("默认限额内放行,超限返回重试秒数", () => {
    process.env.GOSSIP_BOT_USER_RATE_LIMIT = "1";
    assert.deepEqual(consumeBotUserLimit("user-a"), { ok: true });
    const second = consumeBotUserLimit("user-a");
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.retryAfterSec >= 1);

    // 不同用户互不影响
    assert.deepEqual(consumeBotUserLimit("user-b"), { ok: true });
  });

  it("busyReplyText 把秒数折算成分钟提示", () => {
    assert.match(busyReplyText(90), /2 分钟/);
  });
});
