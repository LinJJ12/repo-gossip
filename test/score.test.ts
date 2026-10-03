import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  busFactorOf,
  computeRepoScore,
  confidenceFromMissing,
  formatScoreCard,
  forkStarScore,
  gradeFor,
  logScale,
  momentumOf,
  ratioScale,
  type RepoScoreInput,
} from "../packages/core/src/score.js";

const REF = { owner: "a", repo: "b" };

function richInput(overrides: Partial<RepoScoreInput> = {}): RepoScoreInput {
  return {
    ref: REF,
    fullName: "a/b",
    description: "demo",
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
    // 平稳的 star 时间线(180 天内均匀 ~0.5/天)→ 无突发
    starredAt: Array.from({ length: 90 }, (_, i) =>
      new Date(Date.now() - i * 2 * 86_400_000).toISOString(),
    ),
    starTimelineSkipped: false,
    missing: [],
    ...overrides,
  };
}

describe("score helpers", () => {
  it("logScale: 0→0, cap→100, 对数中段, 负值安全", () => {
    assert.equal(logScale(0, 100), 0);
    assert.equal(logScale(100, 100), 100);
    const half = logScale(9, 100); // log10(10)/log10(101)
    assert.ok(half > 45 && half < 55, `half=${half}`);
    assert.equal(logScale(-5, 100), 0);
  });

  it("ratioScale: 超过 cap 满分", () => {
    assert.equal(ratioScale(50, 100), 50);
    assert.equal(ratioScale(150, 100), 100);
  });

  it("forkStarScore: 健康区间满分,过低线性,过高衰减但不低于 50", () => {
    assert.equal(forkStarScore(0.05), 100);
    assert.equal(forkStarScore(0.6), 100);
    assert.equal(forkStarScore(0), 0);
    assert.equal(forkStarScore(0.025), 50);
    assert.equal(forkStarScore(1.0), 68);
    assert.equal(forkStarScore(3.0), 50);
  });

  it("busFactorOf: 覆盖 50% 贡献量的最少人数", () => {
    assert.equal(busFactorOf([]), null);
    assert.equal(busFactorOf([{ contributions: 10 }]), 1);
    // [8,7,3,2] 总 20,8<10,8+7=15≥10 → 2
    assert.equal(
      busFactorOf([
        { contributions: 8 },
        { contributions: 7 },
        { contributions: 3 },
        { contributions: 2 },
      ]),
      2,
    );
    // 单人独占 → 1
    assert.equal(
      busFactorOf([
        { contributions: 90 },
        { contributions: 5 },
        { contributions: 5 },
      ]),
      1,
    );
  });

  it("momentumOf: 平稳 60,上升满分,下跌走低;不足 12 周 → null", () => {
    const flat = momentumOf(Array.from({ length: 52 }, () => 10));
    assert.equal(flat?.arrow, "→");
    assert.ok(flat && flat.score === 60);

    const rising = momentumOf([
      ...Array.from({ length: 40 }, () => 10),
      ...Array.from({ length: 4 }, () => 20),
    ]);
    assert.equal(rising?.arrow, "↑");

    const falling = momentumOf([
      ...Array.from({ length: 40 }, () => 10),
      ...Array.from({ length: 4 }, () => 0),
    ]);
    assert.equal(falling?.arrow, "↓");
    assert.equal(falling?.score, 0);

    assert.equal(momentumOf(Array.from({ length: 11 }, () => 10)), null);
  });

  it("gradeFor 边界", () => {
    assert.equal(gradeFor(85).id, "gold");
    assert.equal(gradeFor(84).id, "silver");
    assert.equal(gradeFor(70).id, "silver");
    assert.equal(gradeFor(55).id, "bronze");
    assert.equal(gradeFor(40).id, "gilded");
    assert.equal(gradeFor(39).id, "tinfoil");
  });

  it("confidenceFromMissing: 扣减、下限 20、分档", () => {
    assert.equal(confidenceFromMissing([]).value, 100);
    assert.equal(confidenceFromMissing([]).label, "充分");
    const mid = confidenceFromMissing(["weeklyCommits", "contributors"]);
    assert.equal(mid.value, 70);
    assert.equal(mid.label, "尚可");
    const low = confidenceFromMissing([
      "weeklyCommits",
      "contributors",
      "mergedPrs90d",
      "closedIssues90d",
      "checklist",
      "openIssues",
      "subscribers",
      "releases90d",
    ]);
    assert.equal(low.value, 25);
    assert.equal(low.label, "不足");
  });
});

describe("computeRepoScore", () => {
  it("健康大仓库:五维齐全,总分金级,无警示,置信度充分", () => {
    const score = computeRepoScore(richInput());
    assert.ok(score.total !== null && score.total >= 85, `total=${score.total}`);
    assert.equal(score.grade?.id, "gold");
    assert.equal(score.confidence.value, 100);
    for (const d of score.dimensions) {
      assert.ok(d.score !== null, `${d.id} 不应为 null`);
      assert.ok(d.score >= 60, `${d.id}=${d.score}`);
    }
    assert.ok(
      score.sanity.every((c) => c.level === "ok" || c.level === "unknown"),
    );
    // 权重和为 1
    const w = score.dimensions.reduce((s, d) => s + d.weight, 0);
    assert.ok(Math.abs(w - 1) < 1e-9, `weights sum=${w}`);
  });

  it("数据缺失:维度置 null 并重分配权重,置信度下调", () => {
    const input = richInput({
      stars: 42,
      forks: 2,
      subscribers: null,
      weeklyCommits: null,
      contributors: null,
      mergedPrs90d: null,
      closedIssues90d: null,
      openIssues: null,
      releases90d: null,
      hasCi: null,
      hasContributing: null,
      hasSecurity: null,
      starredAt: null,
      starTimelineSkipped: false,
      missing: [
        "weeklyCommits",
        "contributors",
        "mergedPrs90d",
        "closedIssues90d",
        "openIssues",
        "subscribers",
        "releases90d",
        "checklist",
        "stargazers",
      ],
    });
    const score = computeRepoScore(input);
    const byId = new Map(score.dimensions.map((d) => [d.id, d]));
    assert.equal(byId.get("activity")?.score, null);
    assert.equal(byId.get("community")?.score, null);
    assert.equal(byId.get("credibility")?.score, null);
    assert.ok(byId.get("influence")?.score !== null);
    assert.ok(byId.get("engineering")?.score !== null);
    assert.ok(score.total !== null && score.total > 50 && score.total < 80, `total=${score.total}`);
    assert.equal(score.confidence.value, 20);
    assert.equal(score.confidence.label, "不足");
    const w = score.dimensions.reduce((s, d) => s + d.weight, 0);
    assert.ok(Math.abs(w - 1) < 1e-9, `weights sum=${w}`);
  });

  it("高星低互动:四项 sanity 全 fail,信用度归零,含水量高危", () => {
    const input = richInput({
      stars: 5_000,
      forks: 10,
      subscribers: 1,
      openIssuesTotal: 2,
      weeklyCommits: Array.from({ length: 52 }, () => 0),
      contributors: Array.from({ length: 3 }, (_, i) => ({
        login: `dev${i}`,
        contributions: 10,
      })),
      mergedPrs90d: 0,
      closedIssues90d: 0,
      openIssues: 2,
      releases90d: 0,
      starredAt: null,
      starTimelineSkipped: false,
    });
    const score = computeRepoScore(input);
    const fails = score.sanity.filter((c) => c.level === "fail");
    assert.equal(fails.length, 4);
    const cred = score.dimensions.find((d) => d.id === "credibility");
    assert.equal(cred?.score, 0);
    assert.equal(score.grade?.id, "tinfoil");
    // 4 fail × 12 = 48
    assert.equal(score.watermark.percent, 48);
    assert.equal(score.watermark.level, "high-risk");
  });

  it("star 时间线突发:clean → 含水量上升并折入信用度", () => {
    const withSpike = [
      ...Array.from({ length: 27 }, (_, i) =>
        new Date(Date.now() - (40 - i) * 86_400_000).toISOString(),
      ),
      // 单日 +60 的尖峰
      ...Array.from({ length: 60 }, () =>
        new Date(Date.now() - 10 * 86_400_000).toISOString(),
      ),
      ...Array.from({ length: 27 }, (_, i) =>
        new Date(Date.now() - (30 - i) * 86_400_000).toISOString(),
      ),
    ];
    const score = computeRepoScore(
      richInput({ stars: 2_000, forks: 100, starredAt: withSpike }),
    );
    assert.ok(score.watermark.percent >= 30, `percent=${score.watermark.percent}`);
    assert.ok(
      score.watermark.notes.some((n) => n.includes("疑似刷量窗口")),
      JSON.stringify(score.watermark.notes),
    );
  });

  it("同秒注入:微模式折入含水量并进 sanity 证据列表", () => {
    const injected = [
      ...Array.from({ length: 50 }, (_, i) =>
        new Date(Date.now() - i * 86_400_000).toISOString(),
      ),
      // 同一秒 6 个批量注入
      ...Array.from({ length: 6 }, () =>
        new Date(Date.now() - 100_000).toISOString(),
      ),
    ];
    const score = computeRepoScore(
      richInput({
        stars: 2_000,
        forks: 100,
        starredAt: injected,
        stargazerIds: injected.map((_, i) =>
          i >= 50 ? 900_000 + (i - 50) : 1_000_000 + i * 10_000,
        ),
      }),
    );
    assert.ok(
      score.sanity.some((c) => c.id === "micro-same-second-cluster"),
      JSON.stringify(score.sanity.map((c) => c.id)),
    );
    assert.ok(
      score.watermark.notes.some((n) => n.includes("同秒注入")),
      JSON.stringify(score.watermark.notes),
    );
    // 6 连号 id(步长 ≤5)也应命中连号信号
    assert.ok(
      score.sanity.some((c) => c.id === "micro-sequential-ids"),
      JSON.stringify(score.sanity.map((c) => c.id)),
    );
  });

  it("空仓库(weeklyCommits=[]):活跃度按 0 计,而非当作缺失重分配", () => {
    const score = computeRepoScore(
      richInput({ weeklyCommits: [], mergedPrs90d: 0, releases90d: 0 }),
    );
    const act = score.dimensions.find((d) => d.id === "activity");
    assert.ok(act?.score !== null, "activity 不应为 null");
    assert.equal(Math.round(act?.score ?? -1), 0);
  });

  it("archived 仓库仍可评分(不硬性扣分,由活跃度自然反映)", () => {
    const score = computeRepoScore(richInput({ archived: true }));
    assert.ok(score.total !== null);
  });
});

describe("formatScoreCard", () => {
  it("包含总分/等级/维度/警示,plain 无 markdown 粗体", () => {
    const bad = computeRepoScore(
      richInput({
        stars: 5_000,
        forks: 10,
        subscribers: 1,
        openIssuesTotal: 2,
        weeklyCommits: Array.from({ length: 52 }, () => 0),
        contributors: Array.from({ length: 3 }, (_, i) => ({
          login: `dev${i}`,
          contributions: 10,
        })),
        mergedPrs90d: 0,
        closedIssues90d: 0,
        openIssues: 2,
        releases90d: 0,
      }),
    );
    const { markdown, plain } = formatScoreCard(bad);
    assert.match(markdown, /含金量报告 · a\/b/);
    assert.match(markdown, /🧻/);
    assert.match(markdown, /影响力/);
    assert.match(markdown, /健全性警示/);
    assert.match(markdown, /🚨/);
    assert.match(markdown, /含水量估计 48%\(高危\)/);
    assert.ok(!plain.includes("**"));

    const good = formatScoreCard(computeRepoScore(richInput()));
    assert.match(good.markdown, /🥇/);
    assert.match(good.markdown, /置信度 100\(充分\)/);
  });
});

describe("missingSignalLabel", () => {
  it("已知 id 映射为可读文案,未知 id 原样回显", async () => {
    const { missingSignalLabel } = await import("../packages/core/src/score.js");
    assert.equal(missingSignalLabel("stargazers"), "star 时间线(stargazers)");
    assert.equal(missingSignalLabel("stargazers", "en"), "star timeline (stargazers)");
    assert.equal(missingSignalLabel("checklist"), "工程文件清单");
    assert.equal(missingSignalLabel("future-signal"), "future-signal");
  });
});
