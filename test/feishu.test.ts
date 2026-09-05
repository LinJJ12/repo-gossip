import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleFeishuChallenge } from "../apps/bot/src/platforms/feishu.js";

describe("handleFeishuChallenge", () => {
  it("fails closed when token configured but missing", () => {
    assert.throws(
      () =>
        handleFeishuChallenge(
          { type: "url_verification", challenge: "abc" },
          "secret",
        ),
      /mismatch/,
    );
  });

  it("accepts matching token", () => {
    const out = handleFeishuChallenge(
      { type: "url_verification", challenge: "abc", token: "secret" },
      "secret",
    );
    assert.deepEqual(out, { challenge: "abc" });
  });
});
