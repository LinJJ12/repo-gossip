import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateTabloid,
  normalizeRawJson,
  safeParseTabloid,
  type ChatFetch,
} from "../packages/core/src/llm.js";
import { analyzeSnapshot } from "../packages/core/src/analyzer.js";
import type { AnalyzedGossip, RepoSnapshot } from "../packages/core/src/types.js";

const LLM = { apiKey: "test-key", baseUrl: "https://llm.example/v1", model: "m" };

function analyzed(): AnalyzedGossip {
  const snap: RepoSnapshot = {
    ref: { owner: "a", repo: "b" },
    fullName: "a/b",
    description: null,
    stars: 0,
    language: "TypeScript",
    defaultBranch: "main",
    commits: [
      {
        sha: "abc1234",
        message: "fix: payment bug",
        author: "owl",
        date: "2026-09-01T02:15:00.000Z",
        additions: 10,
        deletions: 2,
        files: ["a.ts"],
      },
    ],
    pulls: [],
    issues: [],
    releases: [],
    fetchedAt: new Date().toISOString(),
  };
  return analyzeSnapshot(snap);
}

function okFetch(content: string): ChatFetch & { lastInit?: RequestInit } {
  const fn = ((_url: string, init?: RequestInit) => {
    (fn as { lastInit?: RequestInit }).lastInit = init;
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as ChatFetch & { lastInit?: RequestInit };
  return fn;
}

/**
 * Stands in for a hanging model: rejects the request with an AbortError after
 * `timeoutMs`. We drive the abort with a real `setTimeout` (not the caller's
 * `AbortSignal.timeout`) because that timer is not ref'd under `node:test` —
 * it would otherwise let the event loop drain and cancel the whole suite with
 * "Promise resolution is still pending but the event loop has already
 * resolved". In a real runtime the caller's signal fires on its own and is
 * honored here; the setTimeout is just a safety net that keeps the loop alive.
 */
function hangingFetch(timeoutMs = 50): ChatFetch {
  return (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = () => {
        if (timer) clearTimeout(timer);
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err as unknown as never);
      };
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) return fail();
        signal.addEventListener("abort", fail, { once: true });
      }
      timer = setTimeout(fail, timeoutMs);
    }) as unknown as Promise<Response>;
}

describe("normalizeRawJson", () => {
  it("unwraps a fenced json block", () => {
    const raw = '当然，这是小报：\n```json\n{"epicTitle":"x"}\n```\n希望喜欢';
    assert.equal(normalizeRawJson(raw), '{"epicTitle":"x"}');
  });

  it("trims chatter outside the braces", () => {
    assert.equal(normalizeRawJson('noise {"a":1} noise'), '{"a":1}');
  });

  it("leaves text with no braces untouched", () => {
    assert.equal(normalizeRawJson("not json at all"), "not json at all");
  });
});

describe("safeParseTabloid", () => {
  it("keeps every LLM field when the payload is complete", () => {
    const raw = JSON.stringify({
      epicTitle: "《LLM 写的标题》",
      awardsNarrative: ["🏆 奖项 A"],
      temperatureLine: "🔥 热",
      translations: [{ original: "fix x", drama: "深夜救火", author: "owl" }],
      easterEggLines: ["🥚 彩蛋"],
      closing: "本期到此",
    });
    const { tabloid, degradedFields } = safeParseTabloid(raw, analyzed());
    assert.ok(tabloid);
    assert.equal(tabloid.epicTitle, "《LLM 写的标题》");
    assert.equal(tabloid.closing, "本期到此");
    assert.deepEqual(degradedFields, []);
  });

  it("degrades only the broken fields and keeps the usable ones", () => {
    const raw = JSON.stringify({
      epicTitle: "《LLM 写的标题》",
      awardsNarrative: "这不是数组",
      temperatureLine: "🔥 热",
      translations: [{ original: "fix x", drama: "   ", author: "owl" }],
      easterEggLines: ["🥚 彩蛋"],
      closing: "",
    });
    const { tabloid, degradedFields } = safeParseTabloid(raw, analyzed());
    assert.ok(tabloid);
    assert.equal(tabloid.epicTitle, "《LLM 写的标题》");
    assert.equal(tabloid.temperatureLine, "🔥 热");
    assert.deepEqual(tabloid.easterEggLines, ["🥚 彩蛋"]);
    assert.equal(tabloid.closing, "本期八卦到此结束。");
    assert.deepEqual(degradedFields.sort(), [
      "awardsNarrative",
      "closing",
      "translations",
    ]);
    // Local fill-ins are real content, not empties.
    assert.ok(tabloid.awardsNarrative.length > 0);
    assert.ok(tabloid.translations.every((t) => t.drama.trim().length > 0));
  });

  it("returns null for unparseable payloads", () => {
    const { tabloid } = safeParseTabloid("抱歉我无法完成", analyzed());
    assert.equal(tabloid, null);
  });

  it("returns null when no known key is present", () => {
    const { tabloid } = safeParseTabloid('{"unrelated":1}', analyzed());
    assert.equal(tabloid, null);
  });
});

describe("generateTabloid resilience", () => {
  it("passes an abort signal to every request", async () => {
    const fetchImpl = okFetch(
      JSON.stringify({ epicTitle: "《x》", awardsNarrative: ["a"] }),
    );
    await generateTabloid(analyzed(), LLM, { fetchImpl, timeoutMs: 1_000 });
    assert.ok(fetchImpl.lastInit?.signal, "fetch must receive an abort signal");
  });

  it("falls back with a timeout error instead of hanging", async () => {
    const started = Date.now();
    const result = await generateTabloid(analyzed(), LLM, {
      fetchImpl: hangingFetch(),
      timeoutMs: 50,
    });
    const elapsed = Date.now() - started;

    assert.equal(result.mode, "fallback");
    assert.match(result.llmError ?? "", /timed out/i);
    assert.ok(elapsed < 5_000, `should not hang (took ${elapsed}ms)`);
    // The fallback tabloid is still renderable.
    assert.ok(result.tabloid.epicTitle.length > 0);
  });

  it("keeps llm mode when the payload is merely fenced", async () => {
    const body = JSON.stringify({
      epicTitle: "《围栏里的标题》",
      awardsNarrative: ["🏆 A"],
      temperatureLine: "🔥",
      translations: [{ original: "fix x", drama: "救火", author: "owl" }],
      easterEggLines: [],
      closing: "收工",
    });
    const fetchImpl = okFetch(`好的：\n\`\`\`json\n${body}\n\`\`\``);
    const result = await generateTabloid(analyzed(), LLM, {
      fetchImpl,
      timeoutMs: 1_000,
    });
    assert.equal(result.mode, "llm");
    assert.equal(result.tabloid.epicTitle, "《围栏里的标题》");
    assert.deepEqual(result.degradedFields, ["easterEggLines"]);
  });

  it("falls back only when nothing is usable", async () => {
    const fetchImpl = okFetch("完全不是 JSON");
    const result = await generateTabloid(analyzed(), LLM, {
      fetchImpl,
      timeoutMs: 1_000,
    });
    assert.equal(result.mode, "fallback");
    assert.ok(result.llmError);
  });
});
