import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Octokit } from "@octokit/rest";
import { fetchRepoScoreInput } from "../packages/core/src/github-score.js";
import { runScore } from "../packages/core/src/gossip.js";

const REF = { owner: "a", repo: "b" };

type StubOpts = {
  /** stats 端点行为:200 正常 / 202 永远计算中 / 204 空仓库 */
  commitActivity?: "ok" | "pending" | "empty";
  contributorsCount?: number | "error";
  searchFail?: boolean;
  /** CONTRIBUTING.md 的位置:根目录 / .github / 不存在 / 列表请求报错 */
  contributing?: "ok" | "dotgithub" | "notfound" | "error";
  /** getReadme 行为:ok / notfound */
  readme?: "ok" | "notfound";
  releasesCount?: number;
};

/** 返回的 merged/closed/open 计数按查询词区分,便于断言。 */
function searchCountFor(q: string): number {
  if (q.includes("is:merged")) return 40;
  if (q.includes("is:closed")) return 70;
  return 30;
}

function makeStub(opts: StubOpts = {}): Octokit {
  const {
    commitActivity = "ok",
    contributorsCount = 25,
    searchFail = false,
    contributing = "ok",
    readme = "ok",
    releasesCount = 3,
  } = opts;

  const repo = {
    full_name: "a/b",
    description: "demo repo",
    stargazers_count: 50_000,
    forks_count: 10_000,
    subscribers_count: 3_000,
    open_issues_count: 200,
    language: "TypeScript",
    default_branch: "main",
    created_at: "2018-01-01T00:00:00Z",
    pushed_at: new Date().toISOString(),
    archived: false,
    license: { spdx_id: "MIT" },
  };

  const octokit = {
    repos: {
      get: async () => ({ data: repo }),
      getCommitActivityStats: async () => {
        if (commitActivity === "pending") return { status: 202, data: "" };
        if (commitActivity === "empty") return { status: 204, data: null };
        return {
          status: 200,
          data: Array.from({ length: 52 }, () => ({
            total: 30,
            days: [30, 30, 30, 30, 30, 30, 30],
          })),
        };
      },
      listContributors: async () => {
        if (contributorsCount === "error") throw { status: 500, message: "boom" };
        return {
          data: Array.from({ length: contributorsCount }, (_, i) => ({
            login: `dev${i}`,
            contributions: 10,
          })),
        };
      },
      listReleases: async () => ({
        data: Array.from({ length: releasesCount }, (_, i) => ({
          tag_name: `v1.${i}.0`,
          published_at: new Date(Date.now() - i * 10 * 86_400_000).toISOString(),
        })),
      }),
      getReadme: async () => {
        if (readme === "notfound") throw { status: 404 };
        return { data: { type: "file" } };
      },
      getContent: async ({ path }: { path: string }) => {
        if (path === ".github/workflows") return { data: [{ name: "ci.yml" }] };
        if (path === "/") {
          if (contributing === "error") throw { status: 500, message: "boom" };
          const names = ["LICENSE", "readme.md", "SECURITY.md"];
          if (contributing === "ok") names.push("CONTRIBUTING.md");
          return { data: names.map((name) => ({ name, type: "file" })) };
        }
        if (path === ".github") {
          const items: { name: string; type: string }[] = [
            { name: "workflows", type: "dir" },
          ];
          if (contributing === "dotgithub") {
            items.push({ name: "CONTRIBUTING.md", type: "file" });
          }
          return { data: items };
        }
        throw { status: 404 };
      },
    },
    activity: {
      // 平稳时间线:30 个 star 分散在 30 天,无突发
      listStargazersForRepo: async () => ({
        data: Array.from({ length: 30 }, (_, i) => ({
          starred_at: new Date(Date.now() - i * 86_400_000).toISOString(),
          user: { login: `stargazer${i}` },
        })),
      }),
    },
    search: {
      issuesAndPullRequests: async ({ q }: { q: string }) => {
        if (searchFail) throw { status: 500, message: "boom" };
        return { data: { total_count: searchCountFor(q) } };
      },
    },
  };

  return octokit as unknown as Octokit;
}

describe("fetchRepoScoreInput", () => {
  it("全量成功:字段映射完整,无 missing 信号", async () => {
    const { input, missing } = await fetchRepoScoreInput(makeStub(), REF, {
      statsRetryDelayMs: 1,
    });
    assert.deepEqual(missing, []);
    assert.equal(input.fullName, "a/b");
    assert.equal(input.stars, 50_000);
    assert.equal(input.licenseSpdx, "MIT");
    assert.equal(input.weeklyCommits?.length, 52);
    assert.equal(input.weeklyCommits?.[0], 30);
    assert.equal(input.contributors?.length, 25);
    assert.equal(input.contributorsTruncated, false);
    assert.equal(input.mergedPrs90d, 40);
    assert.equal(input.closedIssues90d, 70);
    assert.equal(input.openIssues, 30);
    assert.equal(input.releases90d, 3);
    assert.equal(input.hasCi, true);
    assert.equal(input.hasReadme, true);
    assert.equal(input.hasContributing, true);
    assert.equal(input.hasSecurity, true);
  });

  it("stats 端点持续 202:weeklyCommits 降级并登记 missing,其余信号不受影响", async () => {
    const { input, missing } = await fetchRepoScoreInput(
      makeStub({ commitActivity: "pending" }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.weeklyCommits, null);
    assert.ok(missing.includes("weeklyCommits"));
    assert.equal(input.mergedPrs90d, 40);
    assert.equal(input.hasCi, true);
  });

  it("Search API 失败:三个计数信号降级,不整单失败", async () => {
    const { input, missing } = await fetchRepoScoreInput(
      makeStub({ searchFail: true }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.mergedPrs90d, null);
    assert.equal(input.closedIssues90d, null);
    assert.equal(input.openIssues, null);
    assert.ok(missing.includes("mergedPrs90d"));
    assert.ok(missing.includes("closedIssues90d"));
    assert.ok(missing.includes("openIssues"));
    assert.equal(input.stars, 50_000);
    assert.equal(input.weeklyCommits?.length, 52);
  });

  it("CONTRIBUTING 仅在 .github/ 下也能被目录清单发现", async () => {
    const { input, missing } = await fetchRepoScoreInput(
      makeStub({ contributing: "dotgithub" }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.hasContributing, true);
    assert.ok(!missing.includes("checklist"));
  });

  it("根目录与 .github 都没有 CONTRIBUTING = 确定不存在(false),不算 missing", async () => {
    const { input, missing } = await fetchRepoScoreInput(
      makeStub({ contributing: "notfound" }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.hasContributing, false);
    assert.ok(!missing.includes("checklist"));
  });

  it("根目录清单请求失败 = 未知,登记 checklist missing", async () => {
    const { input, missing } = await fetchRepoScoreInput(
      makeStub({ contributing: "error" }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.hasContributing, null);
    assert.ok(missing.includes("checklist"));
  });

  it("getReadme 404 = 无 README(false);stats 204 = 空仓库(合法零值)", async () => {
    const { input, missing } = await fetchRepoScoreInput(
      makeStub({ readme: "notfound", commitActivity: "empty" }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.hasReadme, false);
    assert.deepEqual(input.weeklyCommits, []);
    assert.ok(!missing.includes("weeklyCommits"));
    assert.ok(!missing.includes("checklist"));
  });

  it("贡献者满 100 = truncated 标记", async () => {
    const { input } = await fetchRepoScoreInput(
      makeStub({ contributorsCount: 100 }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.contributorsTruncated, true);
    assert.equal(input.contributors?.length, 100);
  });

  it("listContributors 抛错:contributors 降级并登记 missing", async () => {
    const { input, missing } = await fetchRepoScoreInput(
      makeStub({ contributorsCount: "error" }),
      REF,
      { statsRetryDelayMs: 1 },
    );
    assert.equal(input.contributors, null);
    assert.ok(missing.includes("contributors"));
  });
});

describe("runScore (编排)", () => {
  it("注入 stub octokit 端到端出分,评分卡含总分与等级", async () => {
    const { score, message, missing } = await runScore({
      repo: "a/b",
      octokit: makeStub(),
    });
    assert.deepEqual(missing, []);
    assert.ok(score.total !== null && score.total > 70, `total=${score.total}`);
    assert.equal(score.grade?.id, "gold");
    assert.match(message.markdown, /含金量报告 · a\/b/);
    assert.match(message.markdown, /🥇/);
  });
});
