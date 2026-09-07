import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  withGithubRetry,
  isGithubRateLimitError,
  enrichGithubError,
} from "../packages/core/src/github-retry.js";

describe("isGithubRateLimitError", () => {
  it("detects 429", () => {
    assert.equal(isGithubRateLimitError({ status: 429 }), true);
  });

  it("detects 403 rate limit message", () => {
    assert.equal(
      isGithubRateLimitError({
        status: 403,
        message: "API rate limit exceeded",
      }),
      true,
    );
  });

  it("ignores other 403", () => {
    assert.equal(
      isGithubRateLimitError({ status: 403, message: "Not Found" }),
      false,
    );
  });
});

describe("withGithubRetry", () => {
  it("retries 429 then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await withGithubRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          const err = Object.assign(new Error("rate"), { status: 429 });
          throw err;
        }
        return "ok";
      },
      {
        maxAttempts: 3,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.equal(sleeps.length, 2);
  });

  it("enriches exhausted rate limit errors", async () => {
    await assert.rejects(
      () =>
        withGithubRetry(
          async () => {
            throw Object.assign(new Error("hit"), { status: 429 });
          },
          { maxAttempts: 2, sleep: async () => undefined },
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /rate limited|GITHUB_TOKEN/i);
        return true;
      },
    );
  });
});

describe("enrichGithubError", () => {
  it("passes through non-rate errors", () => {
    const err = enrichGithubError(new Error("boom"));
    assert.equal(err.message, "boom");
  });
});
