import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGossipArgs } from "../apps/bot/src/platforms/telegram.js";

describe("parseGossipArgs", () => {
  it("parses repo only", () => {
    assert.deepEqual(parseGossipArgs("vercel/next.js"), {
      repo: "vercel/next.js",
      days: 14,
      offline: false,
    });
  });

  it("parses days and offline", () => {
    assert.deepEqual(parseGossipArgs("vercel/next.js 7 --offline"), {
      repo: "vercel/next.js",
      days: 7,
      offline: true,
    });
  });
});
