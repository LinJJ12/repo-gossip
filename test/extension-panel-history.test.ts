import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logicPath = path.join(
  __dirname,
  "../apps/extension/history-logic.js",
);

function loadLogic() {
  const code = readFileSync(logicPath, "utf8");
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  const ctx = createContext(sandbox);
  runInContext(code, ctx);
  const logic = sandbox.RepoGossipHistoryLogic;
  assert.ok(logic, "RepoGossipHistoryLogic should attach to globalThis");
  return logic;
}

const sampleData = (fullName: string, plain: string) => ({
  mode: "llm",
  warnings: ["note"],
  message: { plain },
  tabloid: {
    epicTitle: `Title for ${fullName}`,
    temperatureLine: "体温线",
    awardsNarrative: ["奖项叙事"],
    easterEggLines: ["彩蛋"],
    closing: "收束",
    translations: [{ author: "alice", original: "x", drama: "y" }],
    analyzed: {
      awards: [{ winner: "alice" }],
      topAuthors: [{ name: "bob" }],
      easterEggs: [{ author: "carol" }],
      temperature: {
        level: "warm",
        emoji: "🌤",
        label: "微热",
        commitsLast3Days: 2,
      },
      snapshot: {
        fullName,
        stars: 10,
        language: "JavaScript",
        description: "desc",
        commits: [
          {
            authorLogin: "dave",
            author: "Dave",
            message: "huge commit body ".repeat(50),
            sha: "abc123",
          },
        ],
      },
    },
  },
});

describe("extension history-logic", () => {
  const {
    normalizeHistoryList,
    findHistoryEntry,
    slimGossipData,
    buildHistoryEntry,
    upsertHistoryList,
    normalizeRepoKey,
    sanitizeTempLevel,
    DEFAULT_LIMIT,
  } = loadLogic();

  it("normalizeRepoKey lowercases and rejects junk", () => {
    assert.equal(normalizeRepoKey("Owner/Repo"), "owner/repo");
    assert.equal(normalizeRepoKey("  a/b  "), "a/b");
    assert.equal(normalizeRepoKey("../etc/passwd"), null);
    assert.equal(normalizeRepoKey('a/b"onclick'), null);
    assert.equal(normalizeRepoKey(""), null);
  });

  it("sanitizeTempLevel whitelists known levels", () => {
    assert.equal(sanitizeTempLevel("blazing"), "blazing");
    assert.equal(sanitizeTempLevel("WARM"), "warm");
    assert.equal(sanitizeTempLevel('cool" onmouseover="x'), "cool");
    assert.equal(sanitizeTempLevel(undefined), "cool");
  });

  it("normalizeHistoryList merges case variants and drops corrupt rows", () => {
    const list = normalizeHistoryList([
      null,
      { repo: "a/b" },
      {
        repo: "Owner/Repo",
        savedAt: 1,
        data: { message: { plain: "old" } },
      },
      {
        repo: "owner/repo",
        savedAt: 2,
        data: { message: { plain: "new" } },
      },
      { repo: "", data: {} },
      "nope",
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].repo, "owner/repo");
    assert.equal(list[0].data.message.plain, "new");
  });

  it("upsertHistoryList dedupes by repo case-insensitively, MRU first, respects limit", () => {
    let list = [];
    for (let i = 0; i < 25; i++) {
      const entry = buildHistoryEntry(
        `owner/repo${i}`,
        sampleData(`owner/repo${i}`, `plain ${i}`),
      );
      list = upsertHistoryList(list, entry, 20);
    }
    assert.equal(list.length, 20);
    assert.equal(list[0].repo, "owner/repo24");
    assert.equal(list[19].repo, "owner/repo5");

    const update = buildHistoryEntry(
      "Owner/Repo5",
      sampleData("owner/repo5", "updated"),
    );
    list = upsertHistoryList(list, update, 20);
    assert.equal(list[0].repo, "owner/repo5");
    assert.equal(list[0].plain, "updated");
    assert.equal(list.filter((e) => e.repo === "owner/repo5").length, 1);
    assert.equal(list.length, 20);
  });

  it("rejects invalid upsert entries", () => {
    const base = [buildHistoryEntry("a/b", sampleData("a/b", "x"))];
    const next = upsertHistoryList(base, { repo: "c/d" }, 20);
    assert.equal(next.length, 1);
    assert.equal(next[0].repo, "a/b");
  });

  it("slimGossipData keeps structured tabloid fields and strips commit bodies", () => {
    const slim = slimGossipData(sampleData("affaan-m/ECC", "hello alice"));
    assert.ok(slim);
    assert.equal(slim.tabloid.temperatureLine, "体温线");
    assert.equal(slim.tabloid.analyzed.temperature.level, "warm");
    assert.equal(slim.tabloid.analyzed.snapshot.fullName, "affaan-m/ECC");
    assert.equal(slim.tabloid.analyzed.snapshot.commitCount, 1);
    assert.equal(slim.tabloid.analyzed.snapshot.commits[0].authorLogin, "dave");
    assert.equal(slim.tabloid.analyzed.snapshot.commits[0].message, undefined);
    assert.equal(slim.tabloid.analyzed.snapshot.commits[0].sha, undefined);
    assert.equal(slim.tabloid.analyzed.awards[0].winner, "alice");
    assert.deepEqual(slim.warnings, ["note"]);
  });

  it("slimGossipData preserves commitCount when re-slimmed", () => {
    const once = slimGossipData(sampleData("a/b", "p"));
    once.tabloid.analyzed.snapshot.commitCount = 99;
    once.tabloid.analyzed.snapshot.commits = [{ authorLogin: "x" }];
    const twice = slimGossipData(once);
    assert.equal(twice.tabloid.analyzed.snapshot.commitCount, 99);
  });

  it("slimGossipData ignores non-array warnings", () => {
    const slim = slimGossipData({
      message: { plain: "p" },
      warnings: "not-an-array",
      tabloid: { epicTitle: "t" },
    });
    assert.equal(slim.warnings, undefined);
    assert.equal(slim.message.plain, "p");
  });

  it("findHistoryEntry and buildHistoryEntry round-trip case-insensitively", () => {
    const entry = buildHistoryEntry(
      "Vercel/Next.js",
      sampleData("vercel/next.js", "drama"),
    );
    assert.ok(entry);
    assert.equal(entry.repo, "vercel/next.js");
    assert.equal(entry.epicTitle, "Title for vercel/next.js");
    const list = upsertHistoryList([], entry, DEFAULT_LIMIT);
    assert.equal(findHistoryEntry(list, "vercel/next.js")?.plain, "drama");
    assert.equal(findHistoryEntry(list, "Vercel/Next.js")?.plain, "drama");
    assert.equal(findHistoryEntry(list, "nope/nope"), null);
  });
});
