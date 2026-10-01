/**
 * 含水量检测(反刷星信号)— 纯函数,无网络调用。
 *
 * 思路参考 StarScout 研究(arXiv:2412.13459,~600 万疑似假 star):
 * 刷量仓库在 star 时间线上呈「突发窗口」形态(短时间大量 star,与基线严重
 * 脱离),并伴随跨信号比例异常(高 star / 低贡献者 / 低互动)。本模块只做
 * 时序突发检测 + 与 P0 比例检查的合成,不做账号级指控。
 */

export type StarBurst = {
  /** ISO 日期(UTC 天) */
  start: string;
  end: string;
  stars: number;
  /** high = 单日尖峰;medium = 连续窗口堆量 */
  level: "high" | "medium";
};

export type WatermarkLevel = "clean" | "suspicious" | "high-risk";

export type Watermark = {
  /** 含水量估计 0-95(刻意封顶,不做绝对指控)。 */
  percent: number;
  level: WatermarkLevel;
  notes: string[];
};

export const WATERMARK_LEVEL_LABEL: Record<WatermarkLevel, string> = {
  clean: "干净",
  suspicious: "存疑",
  "high-risk": "高危",
};

/** 单日 burst 的绝对下限:低于此量的尖峰可能只是聚合效应。 */
const BURST_DAY_ABS_MIN = 40;
/** 连续窗口(≤3 天)堆量的绝对下限。 */
const BURST_WINDOW_ABS_MIN = 80;
/** 观测窗口:时间线只取前 400 个 stargazer,聚合到天可能只覆盖近期。 */
const MIN_SERIES_DAYS = 7;

/**
 * 把 starred_at 时间线(ISO 字符串数组,顺序不限)聚合成按 UTC 天的计数序列
 * (旧→新)。空/无有效时间戳返回 null。
 */
export function starSeriesByDay(
  starredAt: string[],
): { day: string; count: number }[] | null {
  const counts = new Map<string, number>();
  for (const raw of starredAt) {
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, count]) => ({ day, count }));
}

/**
 * 突发检测:
 * - 单日 ≥ max(BURST_DAY_ABS_MIN, 中位数×5, 中位数+3σ) → high
 * - 连续 ≤3 天、日均 ≥ max(BURST_WINDOW_ABS_MIN/3, 中位数×5, 中位数+3σ) → medium
 *
 * 基线锚定在**中位数**(对突发值稳健):平稳的高增速序列(如刚被社区发现的
 * 仓库,每天稳定 +30 star)不会触发误报;只有与自身基线明显脱节的窗口才判定。
 * 观测不足(< MIN_SERIES_DAYS 天)不判定。
 */
export function detectStarBursts(starredAt: string[]): StarBurst[] | null {
  const series = starSeriesByDay(starredAt);
  if (series === null || series.length < MIN_SERIES_DAYS) return null;

  const counts = series.map((s) => s.count);
  const median = medianOf(counts);
  const mean = counts.reduce((s, n) => s + n, 0) / counts.length;
  const variance = counts.reduce((s, n) => s + (n - mean) ** 2, 0) / counts.length;
  const sigma = Math.sqrt(variance);
  const anchored = Math.max(median * 5, median + 3 * sigma);
  const dayThreshold = Math.max(BURST_DAY_ABS_MIN, anchored);
  const windowAvgThreshold = Math.max(BURST_WINDOW_ABS_MIN / 3, anchored);

  const bursts: StarBurst[] = [];
  for (const s of series) {
    if (s.count >= dayThreshold) {
      bursts.push({ start: s.day, end: s.day, stars: s.count, level: "high" });
    }
  }
  if (bursts.length > 0) return bursts;

  // 连续 ≤3 天堆量(滑动窗口,避免重复报告重叠段)。
  let i = 0;
  while (i < series.length) {
    const window = series.slice(i, Math.min(i + 3, series.length));
    const sum = window.reduce((s, w) => s + w.count, 0);
    const windowAvg = sum / window.length;
    if (
      window.length >= 2 &&
      windowAvg >= windowAvgThreshold &&
      sum >= BURST_WINDOW_ABS_MIN
    ) {
      bursts.push({
        start: window[0]!.day,
        end: window[window.length - 1]!.day,
        stars: sum,
        level: "medium",
      });
      i += window.length;
    } else {
      i += 1;
    }
  }
  return bursts;
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 信用度 sanity 检查命中数(warn/fail),由 score.ts 传入。 */
export function estimateWatermark(
  bursts: StarBurst[] | null,
  sanityWarns: number,
  sanityFails: number,
  timelineStatus: "covered" | "skipped" | "failed",
): Watermark {
  const notes: string[] = [];
  let percent = 0;

  if (bursts === null) {
    notes.push(
      timelineStatus === "skipped"
        ? "star 时间线未抓取(低星仓库,无刷量价值)"
        : timelineStatus === "failed"
          ? "star 时间线暂不可用(接口受限或需认证),仅按比例信号估计"
          : "star 时间线覆盖不足,无法做突发检测",
    );
  } else if (bursts.length === 0) {
    notes.push("star 时间线平稳,未见突发窗口");
  } else {
    for (const b of bursts.slice(0, 3)) {
      if (b.level === "high") {
        percent += 30;
        notes.push(`疑似刷量窗口 ${b.start}:单日 +${b.stars} star`);
      } else {
        percent += 18;
        notes.push(`疑似堆量窗口 ${b.start} ~ ${b.end}:3 天 +${b.stars} star`);
      }
    }
  }

  percent += sanityFails * 12 + sanityWarns * 5;
  percent = Math.min(95, Math.round(percent));

  const level: WatermarkLevel =
    percent < 15 ? "clean" : percent < 40 ? "suspicious" : "high-risk";
  return { percent, level, notes };
}
