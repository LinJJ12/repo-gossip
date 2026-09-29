import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RepoSnapshot, Tabloid } from "../packages/core/src/types.js";
import { analyzeSnapshot } from "../packages/core/src/analyzer.js";
import { buildOfflineTabloid } from "../packages/core/src/gossip.js";
import { safeParseTabloid } from "../packages/core/src/llm.js";
import { filterNonPullIssues, mapReleasesInWindow } from "../packages/core/src/github.js";
import { toDiscordEmbed, toFeishuCard } from "../packages/core/src/format.js";

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

/** Build a tabloid whose temperature level depends on commit count (0→frozen, 6→warm, 25→blazing). */
function makeTabloid(commitCount: number): Tabloid {
  const snap = emptySnapshot();
  const now = Date.now();
  snap.commits = Array.from({ length: commitCount }, (_, i) => ({
    sha: `c${i}`,
    message: `feat: thing ${i}`,
    author: "dev",
    date: new Date(now - i * 60_000).toISOString(),
    additions: 1,
    deletions: 0,
    files: ["a.ts"],
  }));
  return buildOfflineTabloid(analyzeSnapshot(snap));
}

const analyzed = () => analyzeSnapshot(emptySnapshot());

describe("safeParseTabloid (parse contract)", () => {
  it("keeps every field on a complete payload", () => {
    const raw = JSON.stringify({
      epicTitle: "《T》",
      awardsNarrative: ["a"],
      temperatureLine: "t",
      translations: [{ original: "fix x", drama: "救火", author: "o" }],
      easterEggLines: ["e"],
      closing: "c",
    });
    const { tabloid, degradedFields } = safeParseTabloid(raw, analyzed());
    assert.ok(tabloid);
    assert.deepEqual(degradedFields, []);
    assert.equal(tabloid!.epicTitle, "《T》");
    assert.equal(tabloid!.closing, "c");
  });

  it("degrades only the field whose type is wrong (array given as string)", () => {
    const raw = JSON.stringify({
      epicTitle: "《T》",
      awardsNarrative: "not an array",
      temperatureLine: "t",
      translations: [{ original: "x", drama: "y", author: "o" }],
      easterEggLines: ["e"],
      closing: "c",
    });
    const { tabloid, degradedFields } = safeParseTabloid(raw, analyzed());
    assert.ok(tabloid);
    // Only the broken field is flagged; the rest keep their LLM values.
    assert.deepEqual(degradedFields, ["awardsNarrative"]);
    assert.equal(tabloid!.epicTitle, "《T》");
    assert.equal(tabloid!.temperatureLine, "t");
    assert.equal(tabloid!.closing, "c");
    assert.deepEqual(tabloid!.translations, [
      { original: "x", drama: "y", author: "o" },
    ]);
    assert.deepEqual(tabloid!.easterEggLines, ["e"]);
    // The broken field is replaced by a local fallback (empty when no awards exist).
    assert.ok(Array.isArray(tabloid!.awardsNarrative));
  });

  it("fills a missing closing from the local default", () => {
    const raw = JSON.stringify({
      epicTitle: "《T》",
      awardsNarrative: ["a"],
      temperatureLine: "t",
      translations: [{ original: "x", drama: "y", author: "o" }],
      easterEggLines: [],
    });
    const { tabloid, degradedFields } = safeParseTabloid(raw, analyzed());
    assert.ok(tabloid);
    assert.ok(degradedFields.includes("closing"));
    assert.equal(tabloid!.closing, "本期八卦到此结束。");
  });

  it("normalizes Chinese-keyed translation entries", () => {
    const raw = JSON.stringify({
      epicTitle: "《T》",
      awardsNarrative: ["a"],
      temperatureLine: "t",
      translations: [{ 原文: "fix x", 翻译: "救火", 作者: "o" }],
      easterEggLines: [],
      closing: "c",
    });
    const { tabloid } = safeParseTabloid(raw, analyzed());
    assert.ok(tabloid);
    assert.equal(tabloid!.translations[0]!.original, "fix x");
    assert.equal(tabloid!.translations[0]!.drama, "救火");
    assert.equal(tabloid!.translations[0]!.author, "o");
  });
});

describe("toDiscordEmbed (Discord contract)", () => {
  it("strips 《》 from the title", () => {
    const embed = toDiscordEmbed(makeTabloid(0));
    assert.doesNotMatch(embed.title, /[《》]/);
  });

  it("maps temperature to embed color", () => {
    assert.equal(toDiscordEmbed(makeTabloid(0)).color, 0x3498db); // frozen → blue
    assert.equal(toDiscordEmbed(makeTabloid(6)).color, 0xf1c40f); // warm → yellow
    assert.equal(toDiscordEmbed(makeTabloid(25)).color, 0xe74c3c); // blazing → red
  });

  it("truncates description to <= 4000 chars", () => {
    const t = makeTabloid(6);
    t.temperatureLine = "x".repeat(5000);
    const embed = toDiscordEmbed(t);
    assert.ok(embed.description.length <= 4000);
    assert.ok(embed.description.length > 0);
  });

  it("does not emit corrupted punctuation in offline copy", () => {
    const embed = toDiscordEmbed(makeTabloid(6));
    assert.doesNotMatch(embed.description, /\?\w/);
  });
});

describe("toFeishuCard (Feishu contract)", () => {
  it("is an interactive card", () => {
    assert.equal(toFeishuCard(makeTabloid(6)).msg_type, "interactive");
  });

  it("maps temperature to header template", () => {
    assert.equal(toFeishuCard(makeTabloid(0)).card.header.template, "blue");
    assert.equal(toFeishuCard(makeTabloid(6)).card.header.template, "orange");
    assert.equal(toFeishuCard(makeTabloid(25)).card.header.template, "red");
  });

  it("truncates lark_md content to <= 4000 chars", () => {
    const t = makeTabloid(6);
    t.temperatureLine = "x".repeat(5000);
    const card = toFeishuCard(t);
    const content = card.card.elements[0]!.text.content;
    assert.ok(content.length <= 4000);
  });
});

describe("mapReleasesInWindow", () => {
  const sinceMs = Date.parse("2026-09-01T00:00:00Z");
  const raw = [
    { tag_name: "v1", published_at: "2026-09-10T00:00:00Z" },
    { tag_name: "v0", published_at: "2026-08-01T00:00:00Z" }, // out of window
    { tag_name: "", published_at: "2026-09-15T00:00:00Z" }, // empty tag
    { tag_name: "v2", published_at: "2026-09-20T00:00:00Z" },
  ];

  it("keeps in-window releases, drops out-of-window and empty-tag ones", () => {
    const out = mapReleasesInWindow(raw, sinceMs, 10);
    assert.deepEqual(
      out.map((r) => r.tag),
      ["v2", "v1"],
    );
    assert.ok(!out.some((r) => r.tag === "v0"), "out-of-window must be dropped");
    assert.ok(!out.some((r) => r.tag === ""), "empty tag must be dropped");
  });

  it("caps at max and sorts newest-first", () => {
    const capped = mapReleasesInWindow(raw, sinceMs, 1);
    assert.deepEqual(
      capped.map((r) => r.tag),
      ["v2"],
    );
  });

  it("guards against false ship-it on dormant repos (regression)", () => {
    const out = mapReleasesInWindow(
      [{ tag_name: "v0.1", published_at: "2020-01-01T00:00:00Z" }],
      sinceMs,
      10,
    );
    assert.deepEqual(out, []);
  });
});

describe("filterNonPullIssues", () => {
  it("drops entries that are actually pull requests", () => {
    const raw = [
      { number: 1, title: "a", pull_request: { url: "x" } },
      { number: 2, title: "b" },
      { number: 3, title: "c", pull_request: { merged_at: "y" } },
    ];
    const out = filterNonPullIssues(raw);
    assert.deepEqual(
      out.map((i) => i.number),
      [2],
    );
  });

  it("keeps genuine issues", () => {
    const raw = [{ number: 9, title: "real issue" }];
    assert.deepEqual(
      filterNonPullIssues(raw).map((i) => i.number),
      [9],
    );
  });
});
