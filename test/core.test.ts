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
    assert.equal(a.notablePulls.length, 0);
    assert.equal(a.hotIssues.length, 0);
    assert.equal(a.latestRelease, null);
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

  it("derives notablePulls, hotIssues, latestRelease and activity awards", () => {
    const snap = activitySnapshot();
    const a = analyzeSnapshot(snap);
    assert.ok(a.notablePulls.some((p) => p.number === 12 && p.merged));
    assert.ok(a.hotIssues.some((i) => i.number === 7));
    assert.equal(a.latestRelease?.tag, "v1.2.0");
    assert.ok(a.awards.some((x) => x.id === "merge-machine"));
    assert.ok(a.awards.some((x) => x.id === "ship-it"));
    assert.match(
      a.awards.find((x) => x.id === "merge-machine")!.reason,
      /2 PRs merged/,
    );
    assert.match(a.awards.find((x) => x.id === "ship-it")!.reason, /v1\.2\.0/);
  });

  it("does not award merge-machine for a single merge", () => {
    const snap = emptySnapshot();
    snap.pulls = [
      {
        number: 1,
        title: "Only one",
        author: "solo",
        state: "closed",
        merged: true,
        updatedAt: "2026-09-12T10:00:00.000Z",
      },
    ];
    const a = analyzeSnapshot(snap);
    assert.equal(a.notablePulls.length, 1);
    assert.ok(!a.awards.some((x) => x.id === "merge-machine"));
  });

  it("ignores empty-tag releases for ship-it", () => {
    const snap = emptySnapshot();
    snap.releases = [
      {
        tag: "",
        name: "oops",
        publishedAt: "2026-09-14T18:00:00.000Z",
        prerelease: false,
      },
    ];
    const a = analyzeSnapshot(snap);
    assert.equal(a.latestRelease, null);
    assert.ok(!a.awards.some((x) => x.id === "ship-it"));
  });

  it("formats safely when snapshot.commits is missing", () => {
    const snap = emptySnapshot();
    const analyzed = analyzeSnapshot(snap);
    // Simulate slim/legacy history payload without commits array.
    (analyzed.snapshot as { commits?: unknown }).commits = undefined;
    const tabloid = buildOfflineTabloid({
      ...analyzed,
      snapshot: analyzed.snapshot,
      notableCommits: [],
    });
    const msg = formatTabloid(tabloid);
    assert.match(msg.markdown, /0 commits/);
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

  it("weaves PR/issue/release clues into offline copy and header counts", () => {
    const snap = activitySnapshot();
    snap.commits = [
      {
        sha: "def5678",
        message: "feat: land the merge",
        author: "merger",
        date: "2026-09-10T12:00:00.000Z",
        additions: 20,
        deletions: 3,
        files: ["x.ts"],
      },
    ];
    const analyzed = analyzeSnapshot(snap);
    const tabloid = buildOfflineTabloid(analyzed);
    const blob = [
      tabloid.epicTitle,
      ...tabloid.awardsNarrative,
      tabloid.temperatureLine,
      ...tabloid.easterEggLines,
      tabloid.closing,
    ].join("\n");
    assert.match(blob, /#12/);
    assert.match(blob, /v1\.2\.0/);
    assert.match(blob, /#7|Issue #7/);

    const msg = formatTabloid(tabloid);
    assert.match(msg.markdown, /PRs/);
    assert.match(msg.markdown, /issues/);
    assert.match(msg.markdown, /releases/);
    assert.doesNotMatch(msg.markdown, /\*\*合并|\*\*议题|\*\*发版/);
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
    pulls: [],
    issues: [],
    releases: [],
    fetchedAt: new Date().toISOString(),
  };
}

function activitySnapshot(): RepoSnapshot {
  const snap = emptySnapshot();
  snap.pulls = [
    {
      number: 12,
      title: "Ship the gossip hooks",
      author: "merger",
      state: "closed",
      merged: true,
      updatedAt: "2026-09-12T10:00:00.000Z",
    },
    {
      number: 11,
      title: "Follow-up polish",
      author: "merger",
      state: "closed",
      merged: true,
      updatedAt: "2026-09-12T08:00:00.000Z",
    },
    {
      number: 9,
      title: "WIP: maybe later",
      author: "slow",
      state: "open",
      merged: false,
      updatedAt: "2026-09-11T08:00:00.000Z",
    },
  ];
  snap.issues = [
    {
      number: 7,
      title: "Flaky CI on Windows",
      author: "reporter",
      state: "open",
      labels: ["bug"],
      updatedAt: "2026-09-13T09:00:00.000Z",
    },
  ];
  snap.releases = [
    {
      tag: "v1.2.0",
      name: "v1.2.0 Gossip Night",
      author: "releaser",
      publishedAt: "2026-09-14T18:00:00.000Z",
      prerelease: false,
    },
  ];
  return snap;
}
