import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideWebhookAuth,
  extractByokEnv,
  extractWebhookCredential,
  resolveCorsAllowOrigin,
} from "../packages/core/src/byok.js";

describe("extractByokEnv", () => {
  it("maps BYOK headers to env keys", () => {
    assert.deepEqual(
      extractByokEnv({
        "x-github-token": "ghp_x",
        "x-llm-api-key": "sk-test",
        "x-llm-base-url": "https://example.com/v1",
        "x-llm-model": "gpt-test",
      }),
      {
        GITHUB_TOKEN: "ghp_x",
        LLM_API_KEY: "sk-test",
        LLM_BASE_URL: "https://example.com/v1",
        LLM_MODEL: "gpt-test",
      },
    );
  });

  it("omits blank headers", () => {
    assert.deepEqual(
      extractByokEnv({
        "x-github-token": "  ",
        "x-llm-api-key": "sk",
      }),
      { LLM_API_KEY: "sk" },
    );
  });

  it("handles array header values", () => {
    assert.deepEqual(
      extractByokEnv({ "x-llm-api-key": ["sk-a", "sk-b"] }),
      { LLM_API_KEY: "sk-a" },
    );
  });

  it("drops metadata SSRF llm base urls", () => {
    assert.deepEqual(
      extractByokEnv({
        "x-llm-api-key": "sk",
        "x-llm-base-url": "http://169.254.169.254/latest",
      }),
      { LLM_API_KEY: "sk" },
    );
  });

  it("LLM_BASE_URL / LLM_MODEL override requires own LLM_API_KEY (atomic BYOK)", () => {
    // 只带 base-url 不带 key:忽略覆写,防服务端 Key 被发往攻击者地址
    assert.deepEqual(
      extractByokEnv({ "x-llm-base-url": "https://evil.example/v1" }),
      {},
    );
    assert.deepEqual(extractByokEnv({ "x-llm-model": "gpt-9" }), {});
    // 带自己的 key:覆写生效
    assert.deepEqual(
      extractByokEnv({
        "x-llm-api-key": "sk-own",
        "x-llm-base-url": "https://evil.example/v1",
        "x-llm-model": "gpt-9",
      }),
      {
        LLM_API_KEY: "sk-own",
        LLM_BASE_URL: "https://evil.example/v1",
        LLM_MODEL: "gpt-9",
      },
    );
  });
});

describe("isAllowedLlmBaseUrl", () => {
  it("allows https public endpoints; localhost only with allowPrivate", async () => {
    const { isAllowedLlmBaseUrl } = await import(
      "../packages/core/src/byok.js"
    );
    assert.equal(isAllowedLlmBaseUrl("https://api.openai.com/v1"), true);
    // 自托管本地网关默认封禁,显式 opt-in 后放行
    assert.equal(isAllowedLlmBaseUrl("http://127.0.0.1:11434/v1"), false);
    assert.equal(
      isAllowedLlmBaseUrl("http://127.0.0.1:11434/v1", { allowPrivate: true }),
      true,
    );
  });

  it("blocks metadata and bad schemes", async () => {
    const { isAllowedLlmBaseUrl } = await import(
      "../packages/core/src/byok.js"
    );
    assert.equal(isAllowedLlmBaseUrl("http://169.254.169.254/"), false);
    assert.equal(isAllowedLlmBaseUrl("file:///etc/passwd"), false);
    assert.equal(isAllowedLlmBaseUrl("not-a-url"), false);
  });

  it("normalizes IPv4-mapped IPv6, trailing dots and private ranges", async () => {
    const { isAllowedLlmBaseUrl } = await import(
      "../packages/core/src/byok.js"
    );
    // metadata 类:opt-in 也不放行
    const alwaysBlocked = [
      "http://[::ffff:169.254.169.254]/v1", // IPv4-mapped IPv6 metadata
      "http://169.254.169.254./v1", // trailing-dot FQDN
      "http://169.254.10.5/v1", // link-local
      "http://100.100.100.100/v1", // Aliyun metadata (CGNAT)
      "http://fd00:ec2::254/v1", // AWS IPv6 metadata (ULA)
      "http://metadata.google.internal/v1",
    ];
    for (const url of alwaysBlocked) {
      assert.equal(isAllowedLlmBaseUrl(url), false, url);
      assert.equal(isAllowedLlmBaseUrl(url, { allowPrivate: true }), false, url);
    }
    // 私网/环回:默认封禁,opt-in 后放行(自托管本地网关)
    const privateBlocked = [
      "http://127.0.0.1/v1",
      "http://10.0.0.8/v1",
      "http://172.16.0.9/v1",
      "http://192.168.1.1/v1",
      "http://[::1]/v1",
    ];
    for (const url of privateBlocked) {
      assert.equal(isAllowedLlmBaseUrl(url), false, url);
      assert.equal(isAllowedLlmBaseUrl(url, { allowPrivate: true }), true, url);
    }
  });
});

describe("extractWebhookCredential", () => {
  it("reads Bearer token", () => {
    assert.equal(
      extractWebhookCredential({ authorization: "Bearer secret-1" }),
      "secret-1",
    );
  });

  it("reads x-webhook-secret", () => {
    assert.equal(
      extractWebhookCredential({ "x-webhook-secret": "secret-2" }),
      "secret-2",
    );
  });

  it("returns undefined when neither header is sent", () => {
    assert.equal(extractWebhookCredential({}), undefined);
  });
});

describe("decideWebhookAuth", () => {
  it("allows public path without secret by default", () => {
    const d = decideWebhookAuth({
      secret: undefined,
      providedCredential: undefined,
      requireSecret: false,
      isProduction: true,
    });
    assert.deepEqual(d, { ok: true, internal: false });
  });

  it("allows public path when secret configured but no credential header", () => {
    const d = decideWebhookAuth({
      secret: "s3cret",
      providedCredential: undefined,
      requireSecret: false,
      isProduction: true,
    });
    assert.deepEqual(d, { ok: true, internal: false });
  });

  it("rejects wrong credential when secret is configured", () => {
    const d = decideWebhookAuth({
      secret: "s3cret",
      providedCredential: "wrong",
      requireSecret: false,
      isProduction: true,
    });
    assert.deepEqual(d, { ok: false, status: 401, error: "unauthorized" });
  });

  it("marks matching credential as internal", () => {
    const d = decideWebhookAuth({
      secret: "s3cret",
      providedCredential: "s3cret",
      requireSecret: false,
      isProduction: true,
    });
    assert.deepEqual(d, { ok: true, internal: true });
  });

  it("kill-switch requires secret in production", () => {
    const d = decideWebhookAuth({
      secret: undefined,
      providedCredential: undefined,
      requireSecret: true,
      isProduction: true,
    });
    assert.deepEqual(d, {
      ok: false,
      status: 500,
      error: "WEBHOOK_SECRET is required in production",
    });
  });

  it("kill-switch allows missing secret outside production", () => {
    const d = decideWebhookAuth({
      secret: undefined,
      providedCredential: undefined,
      requireSecret: true,
      isProduction: false,
    });
    assert.deepEqual(d, { ok: true, internal: false });
  });

  it("kill-switch rejects missing credential when secret is set", () => {
    const d = decideWebhookAuth({
      secret: "s3cret",
      providedCredential: undefined,
      requireSecret: true,
      isProduction: true,
    });
    assert.deepEqual(d, { ok: false, status: 401, error: "unauthorized" });
  });
});

describe("resolveCorsAllowOrigin", () => {
  it("defaults to *", () => {
    assert.equal(resolveCorsAllowOrigin("https://a.test", undefined), "*");
    assert.equal(resolveCorsAllowOrigin("https://a.test", "*"), "*");
  });

  it("echoes matching configured origin", () => {
    assert.equal(
      resolveCorsAllowOrigin(
        "https://ext.example",
        "https://a.test, https://ext.example",
      ),
      "https://ext.example",
    );
  });

  it("falls back to first configured origin when no match", () => {
    assert.equal(
      resolveCorsAllowOrigin("https://other", "https://a.test, https://b.test"),
      "https://a.test",
    );
  });
});

describe("secretEqual", () => {
  it("等长相同/不同与长度差异均正确判定", async () => {
    const { secretEqual } = await import("../packages/core/src/byok.js");
    assert.equal(secretEqual("s3cret", "s3cret"), true);
    assert.equal(secretEqual("s3cret", "s3cerT"), false);
    assert.equal(secretEqual("short", "longer-secret"), false);
    assert.equal(secretEqual("", ""), true);
  });
});
