import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBadgeSvg,
  badgeErrorSvg,
  resolveBadgeRepoParam,
  badgeTextWidth,
} from "../packages/core/src/badge.js";
import { computeRepoScore, type RepoScoreInput } from "../packages/core/src/score.js";

const REF = { owner: "a", repo: "b" };

function input(overrides: Partial<RepoScoreInput> = {}): RepoScoreInput {
  return {
    ref: REF,
    fullName: "a/b",
    description: null,
    language: null,
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

describe("badgeTextWidth", () => {
  it("CJK 宽于 ASCII,输出为确定整数", () => {
    assert.ok(badgeTextWidth("含金量含金量") > badgeTextWidth("score"));
    assert.ok(Number.isInteger(badgeTextWidth("含金量")));
    assert.equal(badgeTextWidth(""), 0);
  });
});

describe("formatBadgeSvg", () => {
  it("正常评分:含分数与等级色,输出合法 SVG", () => {
    const score = computeRepoScore(input());
    const svg = formatBadgeSvg(score);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /含金量/);
    assert.match(svg, new RegExp(`${score.total}`));
    // gold 等级色
    assert.ok(svg.includes("#d4a017"), "gold color expected");
    // 双段矩形:左深右等级色
    assert.match(svg, /<rect x="\d+" width="\d+" height="20" fill="#/);
  });

  it("不同等级 → 不同色(足金 vs 贴纸)", () => {
    const gold = formatBadgeSvg(computeRepoScore(input()));
    const tinfoil = formatBadgeSvg(
      computeRepoScore(
        input({
          stars: 30,
          forks: 0,
          subscribers: 0,
          weeklyCommits: Array.from({ length: 52 }, () => 0),
          contributors: [{ login: "a", contributions: 1 }],
          mergedPrs90d: 0,
          closedIssues90d: 0,
          openIssues: 0,
          releases90d: 0,
          hasCi: false,
          hasReadme: false,
          hasContributing: false,
          hasSecurity: false,
          pushedAt: "2000-01-01T00:00:00Z",
        }),
      ),
    );
    assert.ok(gold.includes("#d4a017"));
    assert.ok(tinfoil.includes("#5a6270"));
  });

  it("无法评分(total null)→ 灰色 N/A 徽章(直接构造防御分支)", () => {
    const score = {
      ref: REF,
      fullName: "a/b",
      total: null,
      grade: null,
      confidence: { value: 20, label: "不足" },
      dimensions: [],
      sanity: [],
      watermark: { percent: 0, level: "clean" as const, notes: [] },
      scoredAt: new Date().toISOString(),
    };
    const svg = formatBadgeSvg(score);
    assert.match(svg, /N\/A/);
    assert.ok(svg.includes("#5a6270"));
  });

  it("badgeErrorSvg 输出合法 N/A 徽章", () => {
    assert.match(badgeErrorSvg(), /N\/A/);
  });
});

describe("resolveBadgeRepoParam", () => {
  it("owner/repo.svg → owner/repo;容忍无后缀", () => {
    assert.equal(resolveBadgeRepoParam("vercel", "next.js.svg"), "vercel/next.js");
    assert.equal(resolveBadgeRepoParam("vercel", "next.js"), "vercel/next.js");
  });

  it("非法输入返回 null", () => {
    assert.equal(resolveBadgeRepoParam("vercel", ""), null);
    assert.equal(resolveBadgeRepoParam("", "a.svg"), null);
    assert.equal(resolveBadgeRepoParam("vercel", "..%2Fetc.svg"), null);
    assert.equal(resolveBadgeRepoParam("-bad-", "repo.svg"), null);
    assert.equal(resolveBadgeRepoParam(undefined, "repo.svg"), null);
    assert.equal(resolveBadgeRepoParam(123, "repo.svg"), null);
  });
});
