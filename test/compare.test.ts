import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Octokit } from "@octokit/rest";
import {
  formatCompareTable,
  formatCompareRadarSvg,
  parseCompareRepos,
  type CompareEntry,
} from "../packages/core/src/compare.js";
import { computeRepoScore, formatScoreCard, type RepoScoreInput } from "../packages/core/src/score.js";
import { runCompare } from "../packages/core/src/gossip.js";
import { formatBadgeSvg } from "../packages/core/src/badge.js";

const REF = { owner: "a", repo: "b" };

function input(
  overrides: Partial<RepoScoreInput> = {},
  fullName = "a/b",
): RepoScoreInput {
  return {
    ref: fullName === "a/b" ? REF : { owner: fullName.split("/")[0]!, repo: fullName.split("/")[1]! },
    fullName,
    description: null,
    language: "TypeScript",
    createdAt: "2018-01-01T00:00:00Z",
    pushedAt: new Date().toISOString(),
    archived: false,
    stars: 50_000,
    forks: 10_000,
    subscribers: 3_000,
    openIssuesTotal: 200,
    openIssues: 100,
    licenseSpdx: "MIT",
    weeklyCommits: Array.from({ length: 52 }, () => 30),
    contributors: Array.from({ length: 30 }, (_, i) => ({
      login: `dev${i}`,
      contributions: 100,
    })),
    contributorsTruncated: false,
    mergedPrs90d: 600,
    closedIssues90d: 100,
    releases90d: 6,
    hasCi: true,
    hasReadme: true,
    hasContributing: true,
    hasSecurity: true,
    starredAt: null,
    starTimelineSkipped: true,
    missing: [],
    ...overrides,
  };
}

function sampleEntries(): CompareEntry[] {
  const good = computeRepoScore(input());
  const weak = computeRepoScore(
    input(
      {
        stars: 800,
        forks: 20,
        subscribers: 5,
        weeklyCommits: Array.from({ length: 52 }, () => 1),
        contributors: [{ login: "solo", contributions: 30 }],
        mergedPrs90d: 2,
        releases90d: 0,
        hasCi: false,
        hasSecurity: false,
      },
      "c/d",
    ),
  );
  return [
    { repo: "a/b", score: good },
    { repo: "c/d", score: weak },
  ];
}

describe("parseCompareRepos", () => {
  it("逗号/空白分隔,去空", () => {
    assert.deepEqual(parseCompareRepos("a/b, c/d\ne/f"), ["a/b", "c/d", "e/f"]);
    assert.deepEqual(parseCompareRepos(["a/b", "c/d"]), ["a/b", "c/d"]);
  });

  it("数量边界", () => {
    assert.throws(() => parseCompareRepos("a/b"), /needs 2-4/);
    assert.throws(
      () => parseCompareRepos("a/b,c/d,e/f,g/h,i/j"),
      /at most 4/,
    );
  });
});

describe("formatCompareRadarSvg", () => {
  it("ariaLabel 注入属性前转义引号(供 dangerouslySetInnerHTML 消费)", () => {
    const svg = formatCompareRadarSvg(sampleEntries(), {
      ariaLabel: '含金量"对比雷达 onmouseover="x',
    });
    assert.ok(!svg.includes('aria-label="含金量"对比'));
    assert.ok(svg.includes("&quot;"));
  });
});

describe("formatCompareTable", () => {
  it("zh:表头/总分/维度/含水量/置信度齐备", () => {
    const { markdown } = formatCompareTable(sampleEntries());
    assert.match(markdown, /含金量对比/);
    assert.match(markdown, /\| 维度 \| a\/b \| c\/d \|/);
    assert.match(markdown, /🏅 总分/);
    assert.match(markdown, /足金/);
    assert.match(markdown, /🧲 影响力/);
    assert.match(markdown, /💧 含水量/);
    assert.match(markdown, /🔎 置信度/);
    assert.ok(!markdown.includes("N/A"));
  });

  it("失败仓库呈 N/A 列并附错误行", () => {
    const entries = [{ repo: "x/y", score: null, error: "Not Found" }];
    entries.push(...sampleEntries());
    const { markdown } = formatCompareTable(entries);
    assert.match(markdown, /N\/A/);
    assert.match(markdown, /x\/y: 评分失败 — Not Found/);
  });

  it("en:标签切换英文", () => {
    const { markdown } = formatCompareTable(sampleEntries(), "en");
    assert.match(markdown, /Gold Comparison/);
    assert.match(markdown, /\| Metric \|/);
    assert.match(markdown, /🏅 Total/);
    assert.match(markdown, /🔎 confidence/);
    assert.match(markdown, /💧 watermark/);
  });
});

describe("formatCompareRadarSvg", () => {
  it("输出合法 SVG:5 层网格 + 每个成功仓库一个多边形", () => {
    const svg = formatCompareRadarSvg(sampleEntries());
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal((svg.match(/<polygon/g) ?? []).length, 4 + 2);
    assert.ok(svg.includes("#d4a017"));
  });

  it("全部失败时仅剩网格(4 个多边形)", () => {
    const entries = [{ repo: "x/y", score: null }];
    const svg = formatCompareRadarSvg(entries);
    assert.equal((svg.match(/<polygon/g) ?? []).length, 4);
  });
});

describe("runCompare(编排)", () => {
  function makeStub(): Octokit {
    const repos: Record<string, { stars: number; full_name: string }> = {
      "a/b": { stars: 50_000, full_name: "a/b" },
      "c/d": { stars: 800, full_name: "c/d" },
    };
    const octokit = {
      repos: {
        get: async ({ owner, repo }: { owner: string; repo: string }) => {
          const key = `${owner}/${repo}`;
          const r = repos[key];
          if (!r) throw { status: 404 };
          return {
            data: {
              full_name: r.full_name,
              description: null,
              stargazers_count: r.stars,
              forks_count: Math.round(r.stars * 0.2),
              subscribers_count: 3_000,
              open_issues_count: 200,
              language: "TypeScript",
              default_branch: "main",
              created_at: "2018-01-01T00:00:00Z",
              pushed_at: new Date().toISOString(),
              archived: false,
              license: { spdx_id: "MIT" },
            },
          };
        },
        getCommitActivityStats: async () => ({
          status: 200,
          data: Array.from({ length: 52 }, () => ({ total: 30, days: [] })),
        }),
        listContributors: async () => ({
          data: Array.from({ length: 30 }, (_, i) => ({
            login: `dev${i}`,
            contributions: 10,
          })),
        }),
        listReleases: async () => ({
          data: [
            {
              tag_name: "v1.0.0",
              published_at: new Date().toISOString(),
            },
          ],
        }),
        getReadme: async () => ({ data: { type: "file" } }),
        getContent: async ({ path }: { path: string }) => {
          if (path === ".github/workflows") return { data: [{ name: "ci.yml" }] };
          if (path === "/" || path === ".github") {
            return { data: [{ name: "CONTRIBUTING.md" }, { name: "SECURITY.md" }] };
          }
          throw { status: 404 };
        },
      },
      activity: {
        listStargazersForRepo: async () => ({
          data: Array.from({ length: 30 }, (_, i) => ({
            starred_at: new Date(Date.now() - i * 86_400_000).toISOString(),
            user: { login: `s${i}` },
          })),
        }),
      },
      search: {
        issuesAndPullRequests: async ({ q }: { q: string }) => ({
          data: { total_count: q.includes("is:merged") ? 40 : q.includes("is:closed") ? 70 : 30 },
        }),
      },
    };
    return octokit as unknown as Octokit;
  }

  it("两个仓库独立评分,对照表与雷达可用", async () => {
    const { entries, message } = await runCompare({
      repos: ["a/b", "c/d"],
      octokit: makeStub(),
    });
    assert.equal(entries.length, 2);
    assert.ok(entries[0]!.score !== null && entries[1]!.score !== null);
    assert.ok(entries[0]!.score.total > entries[1]!.score.total);
    assert.match(message.markdown, /含金量对比/);
  });

  it("单个仓库失败 → N/A 列,其余不受影响", async () => {
    const { entries, message } = await runCompare({
      repos: ["a/b", "ghost/none"],
      octokit: makeStub(),
    });
    assert.equal(entries[0]!.score !== null, true);
    assert.equal(entries[1]!.score, null);
    assert.match(message.markdown, /N\/A/);
  });

  it("少于 2 个仓库直接报错", async () => {
    await assert.rejects(
      () => runCompare({ repos: ["a/b"], octokit: makeStub() }),
      /needs 2-4/,
    );
  });
});

describe("i18n(en)输出", () => {
  it("score en:等级/维度/置信度为英文;zh 保持中文", () => {
    const zh = computeRepoScore(input());
    const en = computeRepoScore(input(), "en");
    assert.equal(zh.grade?.label, "足金");
    assert.equal(en.grade?.label, "Solid Gold");
    assert.equal(en.dimensions[0]!.label, "Influence");
    assert.equal(en.dimensions[4]!.label, "Credibility");
    assert.equal(zh.dimensions[0]!.label, "影响力");

    const { markdown } = formatScoreCard(en, "en");
    assert.match(markdown, /Gold Report/);
    assert.match(markdown, /confidence/);
    assert.match(markdown, /not an accusation/);
  });

  it("badge en:标签为 Gold;zh 为 含金量", () => {
    const en = computeRepoScore(input(), "en");
    assert.match(formatBadgeSvg(en, "en"), />Gold</);
    assert.match(formatBadgeSvg(en, "zh"), />含金量</);
  });
});
