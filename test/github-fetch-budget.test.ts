import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Octokit } from "@octokit/rest";
import {
  fetchRepoSnapshot,
  messageScoreForDetail,
  pickCommitsForDetail,
  resolveDetailBudget,
} from "../packages/core/src/github.js";
import type { RepoRef } from "../packages/core/src/types.js";

const REF: RepoRef = { owner: "a", repo: "b" };

type Stub = {
  octokit: Octokit;
  getCommitCalls: () => number;
  getCommitShas: () => string[];
};

/** In-memory Octokit stub. Counts getCommit calls so we can assert the budget. */
function makeStub(
  commitCount: number,
  opts: { failGetCommit?: boolean } = {},
): Stub {
  let calls = 0;
  const requested: string[] = [];
  const now = Date.now();
  const commits = Array.from({ length: commitCount }, (_, i) => ({
    sha: `sha${i}`,
    commit: {
      message: i < 5 ? `fix: bug ${i}` : `chore: boring bump ${i}`,
      author: {
        name: `dev${i % 3}`,
        date: new Date(now - i * 3_600_000).toISOString(),
      },
      committer: { date: new Date(now - i * 3_600_000).toISOString() },
    },
  }));

  const octokit = {
    repos: {
      get: async () => ({
        data: {
          full_name: "a/b",
          description: null,
          stargazers_count: 10,
          language: "TypeScript",
          default_branch: "main",
        },
      }),
      listCommits: async () => ({ data: commits }),
      getCommit: async ({ ref }: { ref: string }) => {
        calls++;
        requested.push(ref);
        if (opts.failGetCommit) throw new Error("boom");
        return {
          data: {
            sha: ref,
            commit: {
              message: `fix: x ${ref}`,
              author: { name: "d", date: new Date().toISOString() },
              committer: { date: new Date().toISOString() },
            },
            author: { login: "d" },
            stats: { additions: 3, deletions: 1 },
            files: [{ filename: "a.ts" }],
          },
        };
      },
      listReleases: async () => ({ data: [] }),
    },
    pulls: { list: async () => ({ data: [] }) },
    issues: { listForRepo: async () => ({ data: [] }) },
  };

  return {
    octokit: octokit as unknown as Octokit,
    getCommitCalls: () => calls,
    getCommitShas: () => requested,
  };
}

function sampleCommits(n: number) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    sha: `sha${i}`,
    message: i < 5 ? `fix: bug ${i}` : `chore: bump ${i}`,
    date: new Date(now - i * 3_600_000).toISOString(),
  }));
}

describe("pickCommitsForDetail", () => {
  const commits = sampleCommits(40);

  it("caps at budget and always includes the most-recent 8", () => {
    const got = pickCommitsForDetail(commits, 20);
    assert.ok(got.length <= 20, `length ${got.length} should be <= 20`);
    assert.ok(got.length > 0, "should select something");
    for (let i = 0; i < 8; i++) {
      assert.ok(got.includes(`sha${i}`), `recent sha${i} should be selected`);
    }
  });

  it("returns empty when budget is 0", () => {
    assert.deepEqual(pickCommitsForDetail(commits, 0), []);
  });

  it("is deterministic across calls (stable tie-break)", () => {
    const a = pickCommitsForDetail(commits, 20);
    const b = pickCommitsForDetail(commits, 20);
    assert.deepEqual(a, b);
  });

  it("preserves original list order", () => {
    const got = pickCommitsForDetail(commits, 40);
    const idx = got.map((s) => Number(s.slice(3)));
    for (let i = 1; i < idx.length; i++) {
      assert.ok(idx[i]! > idx[i - 1]!, "selected commits must stay in input order");
    }
  });
});

describe("messageScoreForDetail", () => {
  it("rewards fix/bug/hotfix/urgent", () => {
    assert.ok(
      messageScoreForDetail({ message: "fix: x", date: "2026-01-01T12:00:00Z" }) >=
        4,
    );
  });
  it("rewards very short messages", () => {
    assert.ok(
      messageScoreForDetail({ message: "hi", date: "2026-01-01T12:00:00Z" }) >=
        3,
    );
  });
  it("rewards late-night UTC hours", () => {
    assert.ok(
      messageScoreForDetail({
        message: "chore: x",
        date: "2026-01-01T03:00:00Z",
      }) >= 2,
    );
  });
});

describe("resolveDetailBudget", () => {
  const prev = process.env.GOSSIP_MAX_COMMIT_DETAILS;
  after(() => {
    if (prev === undefined) delete process.env.GOSSIP_MAX_COMMIT_DETAILS;
    else process.env.GOSSIP_MAX_COMMIT_DETAILS = prev;
  });

  it("prefers the explicit argument", () => {
    assert.equal(resolveDetailBudget(7), 7);
  });
  it("falls back to the env var", () => {
    process.env.GOSSIP_MAX_COMMIT_DETAILS = "11";
    assert.equal(resolveDetailBudget(), 11);
    delete process.env.GOSSIP_MAX_COMMIT_DETAILS;
  });
  it("defaults to 20 when nothing is set", () => {
    delete process.env.GOSSIP_MAX_COMMIT_DETAILS;
    assert.equal(resolveDetailBudget(), 20);
  });
  it("ignores negative / non-finite explicit and uses the default", () => {
    delete process.env.GOSSIP_MAX_COMMIT_DETAILS;
    assert.equal(resolveDetailBudget(-1), 20);
    assert.equal(resolveDetailBudget(Number.NaN), 20);
  });
});

describe("fetchRepoSnapshot detail budgeting", () => {
  it("budget 0 fetches zero details but still builds a snapshot", async () => {
    const stub = makeStub(40);
    const snap = await fetchRepoSnapshot(stub.octokit, REF, {
      maxCommitDetails: 0,
    });
    assert.equal(stub.getCommitCalls(), 0);
    assert.equal(snap.commits.length, 40);
    assert.equal(snap.statsIncomplete, undefined);
    assert.equal(snap.commits[0]!.sha, "sha0");
    // skipped commits keep list-level info only — no stats, no false alarm
    assert.equal(snap.commits[0]!.additions, 0);
    assert.deepEqual(snap.commits[0]!.files, []);
  });

  it("budget 20 fetches at most ~20 details", async () => {
    const stub = makeStub(40);
    await fetchRepoSnapshot(stub.octokit, REF, { maxCommitDetails: 20 });
    assert.ok(
      stub.getCommitCalls() <= 20,
      `getCommit calls ${stub.getCommitCalls()} should be <= 20`,
    );
    assert.ok(stub.getCommitCalls() > 0, "should still fetch some details");
  });

  it("marks statsIncomplete only when a detail fetch truly fails", async () => {
    const stub = makeStub(40, { failGetCommit: true });
    const snap = await fetchRepoSnapshot(stub.octokit, REF, {
      maxCommitDetails: 10,
    });
    assert.equal(snap.statsIncomplete, true);
  });

  it("does NOT set statsIncomplete when only budget-skipped", async () => {
    const stub = makeStub(40);
    const snap = await fetchRepoSnapshot(stub.octokit, REF, {
      maxCommitDetails: 10,
    });
    assert.equal(snap.statsIncomplete, undefined);
  });
});
