import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectStarBursts,
  detectStarMicroPatterns,
  estimateWatermark,
  starSeriesByDay,
} from "../packages/core/src/watermark.js";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

describe("starSeriesByDay", () => {
  it("按 UTC 天聚合并旧→新排序", () => {
    const series = starSeriesByDay([
      daysAgo(0),
      daysAgo(0),
      daysAgo(1),
      daysAgo(2),
    ]);
    assert.equal(series?.length, 3);
    assert.equal(series?.[0]?.count, 1);
    assert.equal(series?.[2]?.count, 2);
  });

  it("无效时间戳跳过;空输入返回 null", () => {
    assert.equal(starSeriesByDay(["not-a-date"]), null);
    assert.equal(starSeriesByDay([]), null);
    const series = starSeriesByDay(["2026-01-01T00:00:00Z", "garbage"]);
    assert.equal(series?.length, 1);
  });
});

describe("detectStarBursts", () => {
  it("覆盖不足(<7 天)返回 null", () => {
    assert.equal(
      detectStarBursts([daysAgo(0), daysAgo(1), daysAgo(2)]),
      null,
    );
    assert.equal(detectStarBursts([]), null);
  });

  it("平稳低增长序列不误报", () => {
    const starredAt = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
    const bursts = detectStarBursts(starredAt);
    assert.deepEqual(bursts, []);
  });

  it("单日尖峰(≥ max(40, 均值+3σ))→ high", () => {
    const starredAt = [
      ...Array.from({ length: 15 }, (_, i) => daysAgo(29 - i)),
      ...Array.from({ length: 60 }, () => daysAgo(10)),
      ...Array.from({ length: 14 }, (_, i) => daysAgo(9 - i)),
    ];
    const bursts = detectStarBursts(starredAt);
    assert.equal(bursts?.length, 1);
    assert.equal(bursts?.[0]?.level, "high");
    assert.equal(bursts?.[0]?.stars, 60);
  });

  it("平稳高增速(如刚被社区发现的仓库)不误报", () => {
    // 13 天每天 30 star:与自身基线无脱节,不应判为突发
    const starredAt: string[] = [];
    for (let d = 0; d < 13; d++) {
      for (let k = 0; k < 30; k++) starredAt.push(daysAgo(d));
    }
    assert.deepEqual(detectStarBursts(starredAt), []);
  });

  it("连续 3 天堆量(无单日尖峰)→ medium", () => {
    const starredAt = [
      ...Array.from({ length: 26 }, (_, i) => daysAgo(4 + i)), // 每天 1 个,4~29 天前
      ...Array.from({ length: 3 }, (_, k) =>
        Array.from({ length: 30 }, () => daysAgo(1 + k)),
      ).flat(),
    ];
    const bursts = detectStarBursts(starredAt);
    assert.equal(bursts?.length, 1);
    assert.equal(bursts?.[0]?.level, "medium");
    assert.equal(bursts?.[0]?.stars, 90);
  });
});

describe("estimateWatermark", () => {
  it("无突发且无比例异常 → clean 0", () => {
    const w = estimateWatermark([], 0, 0, "covered");
    assert.equal(w.percent, 0);
    assert.equal(w.level, "clean");
    assert.match(w.notes[0]!, /平稳/);
  });

  it("high 突发 + 2 fail → 高危", () => {
    const w = estimateWatermark(
      [{ start: "2026-09-20", end: "2026-09-20", stars: 80, level: "high" }],
      0,
      2,
      "covered",
    );
    assert.equal(w.percent, 54);
    assert.equal(w.level, "high-risk");
  });

  it("时间线不可用/未抓取时如实标注", () => {
    // 有数据但不足 7 天
    const w = estimateWatermark(null, 0, 0, "covered");
    assert.equal(w.level, "clean");
    assert.match(w.notes[0]!, /覆盖不足/);
    // 低星仓库主动跳过
    const w2 = estimateWatermark(null, 0, 0, "skipped");
    assert.match(w2.notes[0]!, /未抓取/);
    // 抓取失败(接口受限/未认证)
    const w3 = estimateWatermark(null, 0, 0, "failed");
    assert.match(w3.notes[0]!, /暂不可用/);
  });
});

// ---------------------------------------------------------------------------
// 微模式检测(参考 fake-star-audit:同秒注入 / 短窗堆量 / 间隔机械化 / 连号 / 农场)
// ---------------------------------------------------------------------------

describe("detectStarMicroPatterns", () => {
  function isoAt(ms: number): string {
    return new Date(ms).toISOString();
  }

  it("样本不足(<30)返回 null 不判定", () => {
    const few = Array.from({ length: 10 }, (_, i) => isoAt(1_000_000 + i));
    assert.equal(detectStarMicroPatterns(few), null);
  });

  it("平稳分散的真人时间线无命中", () => {
    // 60 个 star 均匀散布在 60 天(间隔 1 天),id 随机大步长,登录名各异
    const t0 = Date.now();
    const times = Array.from({ length: 60 }, (_, i) => isoAt(t0 - i * 86_400_000));
    const ids = Array.from({ length: 60 }, (_, i) => 1_000_000 + i * 5_000);
    const logins = Array.from({ length: 60 }, (_, i) => `human${i}abc`);
    assert.deepEqual(detectStarMicroPatterns(times, ids, logins), []);
  });

  it("同一秒批量注入 → same-second-cluster", () => {
    const t0 = Date.now();
    // 60 个正常 + 峰值同一秒 6 个
    const times = [
      ...Array.from({ length: 60 }, (_, i) => isoAt(t0 - i * 86_400_000)),
      ...Array.from({ length: 6 }, () => isoAt(t0 - 100_000)),
    ];
    const hits = detectStarMicroPatterns(times);
    assert.ok(hits?.some((h) => h.id === "same-second-cluster"));
  });

  it("30 秒滑窗堆量 → tight-window-cluster", () => {
    const t0 = Date.now();
    const times = [
      ...Array.from({ length: 60 }, (_, i) => isoAt(t0 - i * 86_400_000)),
      // 30 秒内 9 个(分散在不同秒,不触发同秒)
      ...Array.from({ length: 9 }, (_, i) => isoAt(t0 - 200_000 + i * 3_000)),
    ];
    const hits = detectStarMicroPatterns(times);
    assert.ok(hits?.some((h) => h.id === "tight-window-cluster"));
  });

  it("间隔机械化(匀速高频)→ regular-intervals", () => {
    const t0 = Date.now();
    // 每 60 秒一颗,共 60 颗:中位间隔 60s < 90s,CV = 0
    const times = Array.from({ length: 60 }, (_, i) => isoAt(t0 - i * 60_000));
    const hits = detectStarMicroPatterns(times);
    assert.ok(hits?.some((h) => h.id === "regular-intervals"));
  });

  it("账号 id 近乎连号 → sequential-ids", () => {
    const t0 = Date.now();
    const times = Array.from({ length: 40 }, (_, i) => isoAt(t0 - i * 3_600_000));
    // 前 5 个(时间上连续)账号 id 步长 1
    const ids = times.map((_, i) =>
      i < 5 ? 900_000 + i : 1_000_000 + i * 10_000,
    );
    const hits = detectStarMicroPatterns(times, ids);
    assert.ok(hits?.some((h) => h.id === "sequential-ids"));
  });

  it("同一天同基础名数字尾巴 → login-farm-cluster", () => {
    const t0 = Date.now();
    const times = [
      ...Array.from({ length: 30 }, (_, i) => isoAt(t0 - i * 86_400_000)),
      // 同一天 6 个 farm 账号
      ...Array.from({ length: 6 }, (_, i) => isoAt(t0 - 500_000 + i)),
    ];
    const logins = [
      ...Array.from({ length: 30 }, (_, i) => `normal${i}user`),
      ...Array.from({ length: 6 }, (_, i) => `farmbot${100 + i}`),
    ];
    const hits = detectStarMicroPatterns(times, undefined, logins);
    assert.ok(hits?.some((h) => h.id === "login-farm-cluster"));
  });

  it("微模式命中折入含水量:每个 +12 且落 note", () => {
    const t0 = Date.now();
    const times = [
      ...Array.from({ length: 60 }, (_, i) => isoAt(t0 - i * 86_400_000)),
      ...Array.from({ length: 6 }, () => isoAt(t0 - 100_000)),
    ];
    const hits = detectStarMicroPatterns(times);
    const clean = estimateWatermark([], 0, 0, "covered");
    const withHits = estimateWatermark([], 0, 0, "covered", "zh", hits);
    assert.equal(withHits.percent, clean.percent + 12 * hits!.length);
    assert.ok(withHits.notes.some((n) => n.includes("同秒注入")));
  });
});
