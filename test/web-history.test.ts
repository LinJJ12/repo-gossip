import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_HISTORY_LIMIT,
  buildHistoryEntry,
  findHistoryEntry,
  formatSavedAt,
  loadHistoryFromStorage,
  normalizeHistoryList,
  normalizeRepoKey,
  resolveRepoKey,
  sanitizeTempLevel,
  saveHistoryToStorage,
  slimGossipData,
  upsertHistoryInStorage,
  upsertHistoryList,
  type HistoryEntry,
} from "../apps/web/src/history.ts";

const sampleData = (fullName: string, plain: string) => ({
  mode: "llm" as const,
  warnings: ["note"],
  message: { plain, markdown: plain },
  tabloid: {
    epicTitle: `Title for ${fullName}`,
    temperatureLine: "体温线",
    awardsNarrative: ["奖项叙事"],
    easterEggLines: ["彩蛋"],
    closing: "收束",
    translations: [{ author: "alice", original: "x", drama: "y" }],
    analyzed: {
      awards: [
        {
          id: "a",
          title: "t",
          emoji: "🏆",
          winner: "alice",
          reason: "r",
        },
      ],
      topAuthors: [{ name: "bob", commits: 3 }],
      easterEggs: [
        {
          tag: "e",
          emoji: "🥚",
          evidence: "e",
          sha: "abc",
          author: "carol",
        },
      ],
      temperature: {
        level: "warm" as const,
        emoji: "🌤",
        label: "微热",
        commitsLast3Days: 2,
        daysSinceLastCommit: 0,
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

describe("web history", () => {
  it("normalizeRepoKey lowercases and rejects junk", () => {
    assert.equal(normalizeRepoKey("Owner/Repo"), "owner/repo");
    assert.equal(normalizeRepoKey("  a/b  "), "a/b");
    assert.equal(normalizeRepoKey("../etc/passwd"), null);
    assert.equal(normalizeRepoKey(""), null);
  });

  it("resolveRepoKey accepts URL and snapshot fallback", () => {
    assert.equal(
      resolveRepoKey("https://github.com/Vercel/Next.js"),
      "vercel/next.js",
    );
    assert.equal(
      resolveRepoKey("not-a-repo", sampleData("Owner/Repo", "p")),
      "owner/repo",
    );
  });

  it("sanitizeTempLevel whitelists known levels", () => {
    assert.equal(sanitizeTempLevel("blazing"), "blazing");
    assert.equal(sanitizeTempLevel("WARM"), "warm");
    assert.equal(sanitizeTempLevel(undefined), "cool");
  });

  it("upsertHistoryList dedupes MRU and respects limit", () => {
    let list: ReturnType<typeof buildHistoryEntry>[] = [];
    for (let i = 0; i < 25; i++) {
      const entry = buildHistoryEntry(
        `owner/repo${i}`,
        sampleData(`owner/repo${i}`, `plain ${i}`),
      );
      list = upsertHistoryList(
        list.filter(Boolean) as NonNullable<typeof entry>[],
        entry,
        20,
      );
    }
    assert.equal(list.length, 20);
    assert.equal(list[0]!.repo, "owner/repo24");

    const update = buildHistoryEntry(
      "Owner/Repo5",
      sampleData("owner/repo5", "updated"),
    );
    list = upsertHistoryList(list, update, 20);
    assert.equal(list[0]!.repo, "owner/repo5");
    assert.equal(list[0]!.plain, "updated");
    assert.equal(list.length, 20);
  });

  it("slimGossipData strips commit bodies", () => {
    const slim = slimGossipData(sampleData("affaan-m/ECC", "hello"));
    assert.ok(slim);
    assert.equal(slim.tabloid.analyzed.snapshot.commits[0]?.authorLogin, "dave");
    assert.equal(
      (slim.tabloid.analyzed.snapshot.commits[0] as { message?: string })
        ?.message,
      undefined,
    );
  });

  it("buildHistoryEntry works with GitHub URL input", () => {
    const entry = buildHistoryEntry(
      "https://github.com/Vercel/Next.js",
      sampleData("vercel/next.js", "drama"),
    );
    assert.ok(entry);
    assert.equal(entry.repo, "vercel/next.js");
    assert.equal(entry.epicTitle, "Title for vercel/next.js");
  });

  it("findHistoryEntry round-trips case-insensitively", () => {
    const entry = buildHistoryEntry(
      "Vercel/Next.js",
      sampleData("vercel/next.js", "drama"),
    );
    const list = upsertHistoryList([], entry, DEFAULT_HISTORY_LIMIT);
    assert.equal(findHistoryEntry(list, "vercel/next.js")?.plain, "drama");
    assert.equal(findHistoryEntry(list, "Vercel/Next.js")?.plain, "drama");
  });

  it("localStorage helpers round-trip and tolerate bad JSON", () => {
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => (k in mem ? mem[k]! : null),
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
    };
    const entry = buildHistoryEntry("a/b", sampleData("a/b", "x"));
    assert.ok(entry);
    upsertHistoryInStorage("a/b", sampleData("a/b", "x"), storage);
    const loaded = loadHistoryFromStorage(storage);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.repo, "a/b");

    mem.repoGossipHistory = "{not-json";
    assert.deepEqual(loadHistoryFromStorage(storage), []);

    saveHistoryToStorage(
      normalizeHistoryList([
        { repo: "c/d", savedAt: 1, plain: "p", data: null as unknown as HistoryEntry["data"] },
      ]),
      storage,
    );
    assert.equal(loadHistoryFromStorage(storage).length, 0);
  });

  it("normalizeHistoryList drops entries without analyzable tabloid", () => {
    const list = normalizeHistoryList([
      {
        repo: "a/b",
        savedAt: 1,
        plain: "p",
        data: { message: { plain: "p" }, tabloid: { epicTitle: "x" } },
      },
      buildHistoryEntry("c/d", sampleData("c/d", "ok")),
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.repo, "c/d");
  });

  it("formatSavedAt pads month-day time", () => {
    const s = formatSavedAt(Date.UTC(2026, 0, 5, 3, 7));
    assert.match(s, /^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
