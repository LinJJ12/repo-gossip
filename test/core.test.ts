import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRepoRef } from "../packages/core/src/config.js";
import { analyzeSnapshot } from "../packages/core/src/analyzer.js";
import { buildOfflineTabloid } from "../packages/core/src/gossip.js";
import { dramatizeLocally } from "../packages/core/src/llm.js";
import { formatTabloid } from "../packages/core/src/format.js";
import type { RepoSnapshot } from "../packages/core/src/types.js";

describe("parseRepoRef", () => {
  it("parses owner/repo", () => {
    assert.deepEqual(parseRepoRef("vercel/next.js"), {
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("parses github URL", () => {
    assert.deepEqual(parseRepoRef("https://github.com/sindresorhus/is"), {
      owner: "sindresorhus",
      repo: "is",
    });
  });

  it("rejects junk", () => {
    assert.throws(() => parseRepoRef("not a repo"), /Cannot parse/);
  });
});

describe("analyzeSnapshot", () => {
  it("marks frozen when no commits", () => {
    const snap = emptySnapshot();
    const a = analyzeSnapshot(snap);
    assert.equal(a.temperature.level, "frozen");
    assert.equal(a.awards.length, 0);
  });

  it("awards night owl for early-hour UTC commit", () => {
    const snap = emptySnapshot();
    snap.commits = [
      {
        sha: "abc1234",
        message: "fix: stuff",
        author: "owl",
        date: "2026-09-01T02:15:00.000Z",
        additions: 10,
        deletions: 2,
        files: ["a.ts"],
      },
    ];
    const a = analyzeSnapshot(snap);
    assert.ok(a.notableCommits.length >= 1);
    assert.ok(a.awards.some((x) => x.id === "night-owl"));
  });
});

describe("buildOfflineTabloid", () => {
  it("formats awards without corrupted punctuation", () => {
    const snap = emptySnapshot();
    snap.commits = [
      {
        sha: "abc1234",
        message: "fix",
        author: "owl",
        date: "2026-09-01T02:15:00.000Z",
        additions: 1,
        deletions: 0,
        files: [],
      },
    ];
    const tabloid = buildOfflineTabloid(analyzeSnapshot(snap));
    for (const line of tabloid.awardsNarrative) {
      assert.doesNotMatch(line, /\?\w/);
      assert.match(line, /\(/);
    }
    const msg = formatTabloid(tabloid);
    assert.match(msg.markdown, /repo-gossip|八卦|大片|体温/);
  });
});

describe("normalizeTranslations", () => {
  it("accepts Chinese field names", async () => {
    const { normalizeTranslations } = await import(
      "../packages/core/src/llm.js"
    );
    const out = normalizeTranslations([
      {
        "\u539f\u6587": "fix: bug",
        "\u7ffb\u8bd1": "\u9ad8\u70e7\u6551\u4eba",
        "\u4f5c\u8005": "alice",
      },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.original, "fix: bug");
    assert.equal(out[0]!.drama, "\u9ad8\u70e7\u6551\u4eba");
    assert.equal(out[0]!.author, "alice");
  });
});

describe("dramatizeLocally", () => {
  it("special-cases fix commits", () => {
    const out = dramatizeLocally("fix: payment bug");
    assert.match(out, /\u81f4\u547d\u9690\u60a3|payment bug/);
  });
});

function emptySnapshot(): RepoSnapshot {
  return {
    ref: { owner: "a", repo: "b" },
    fullName: "a/b",
    description: null,
    stars: 0,
    language: "TypeScript",
    defaultBranch: "main",
    commits: [],
    fetchedAt: new Date().toISOString(),
  };
}
