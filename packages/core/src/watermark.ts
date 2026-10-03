/**
 * 含水量检测(反刷星信号)— 纯函数,无网络调用。
 *
 * 思路参考 StarScout 研究(arXiv:2412.13459,~600 万疑似假 star)与开源实现
 * fake-star-audit / StarMapper:刷量仓库在 star 时间线上呈「突发窗口」形态
 * (短时间大量 star,与基线严重脱离),并伴随跨信号比例异常(高 star /
 * 低贡献者 / 低互动)。本模块只做时序突发 + 微模式检测与合成,不做账号级指控。
 */

import type { ScoreLocale } from "./types.js";

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

const LEVEL_LABEL_EN: Record<WatermarkLevel, string> = {
  clean: "clean",
  suspicious: "suspicious",
  "high-risk": "high-risk",
};

/** 含水量分级标签(zh 默认)。 */
export function watermarkLevelLabel(
  level: WatermarkLevel,
  locale: ScoreLocale = "zh",
): string {
  return locale === "en" ? LEVEL_LABEL_EN[level] : WATERMARK_LEVEL_LABEL[level];
}

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

// ---------------------------------------------------------------------------
// 微模式检测(证据级信号,参考 fake-star-audit 的五信号设计):
// 同一份数据就能算,无需额外 API 调用。全部保守判定,只报告统计模式,
// 不指控任何账号 —— 单一信号命中只构成 warn 级证据。
// ---------------------------------------------------------------------------

export type StarMicroPatternId =
  | "same-second-cluster"
  | "tight-window-cluster"
  | "regular-intervals"
  | "sequential-ids"
  | "login-farm-cluster";

export type StarMicroPattern = {
  id: StarMicroPatternId;
  zh: string;
  en: string;
};

/** 有效样本下限:太短的时间线在这些统计上没有意义。 */
const MICRO_MIN_SAMPLES = 30;
/** 同一秒最多可接受的自然星数;超过视为批量注入。 */
const SAME_SECOND_MIN = 5;
/** 滑窗堆量:窗口长度与最少星数(自然爆发不至于 30 秒 8 星)。 */
const TIGHT_WINDOW_SEC = 30;
const TIGHT_WINDOW_MIN = 8;
/** 间隔规律性:样本量、中位间隔上限(高频)与变异系数上限(机械匀速)。 */
const REGULAR_MIN_GAPS = 40;
const REGULAR_MEDIAN_GAP_MS = 90_000;
const REGULAR_CV_MAX = 0.2;
/** 连号检测:相邻账号 id 差 ≤ SEQ_MAX_STEP 的连续链 ≥ SEQ_MIN_CHAIN。 */
const SEQ_MIN_CHAIN = 4;
const SEQ_MAX_STEP = 5;
/** 昵称农场:同一天同基础名(剥尾部数字)+ 数字尾巴的账号数。 */
const FARM_MIN_GROUP = 5;
const FARM_MIN_BASE_LEN = 3;

/**
 * star 时间线微模式检测。
 * @param starredAt ISO 时间戳数组(与 ids/logins 按下标对齐,可为不同长度)
 * @param stargazerIds 对应 stargazer 的 user.id(不可得为 null;无则跳过连号检测)
 * @param stargazerLogins 对应 stargazer 的 user.login(不可得为 null;无则跳过农场检测)
 * @returns 命中的信号列表(可为空);时间线样本不足时返回 null(不判定、不加分)
 */
export function detectStarMicroPatterns(
  starredAt: string[],
  stargazerIds?: (number | null)[],
  stargazerLogins?: (string | null)[],
): StarMicroPattern[] | null {
  const times: number[] = [];
  for (const raw of starredAt) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) times.push(t);
  }
  if (times.length < MICRO_MIN_SAMPLES) return null;
  times.sort((a, b) => a - b);

  const hits: StarMicroPattern[] = [];

  // 同秒注入:精确相同秒级时间戳的峰值。
  const perSecond = new Map<number, number>();
  for (const t of times) {
    const sec = Math.floor(t / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
  }
  const sameSecondPeak = Math.max(...perSecond.values());
  if (sameSecondPeak >= SAME_SECOND_MIN) {
    hits.push({
      id: "same-second-cluster",
      zh: `同秒注入:峰值同一秒 ${sameSecondPeak} 个 star,自然增长几乎不可能`,
      en: `same-second injection: up to ${sameSecondPeak} stars within a single second`,
    });
  }

  // 短窗堆量:30 秒滑窗最大计数(双指针)。
  let tightPeak = 0;
  let i = 0;
  for (let j = 0; j < times.length; j++) {
    while (times[j]! - times[i]! > TIGHT_WINDOW_SEC * 1000) i += 1;
    tightPeak = Math.max(tightPeak, j - i + 1);
  }
  if (tightPeak >= TIGHT_WINDOW_MIN) {
    hits.push({
      id: "tight-window-cluster",
      zh: `短窗堆量:${TIGHT_WINDOW_SEC} 秒内最多 ${tightPeak} 个 star`,
      en: `tight-window spike: up to ${tightPeak} stars within ${TIGHT_WINDOW_SEC}s`,
    });
  }

  // 间隔机械化:中位间隔短且变异系数极低 —— 真人星是爆发且不规则的。
  const gaps: number[] = [];
  for (let k = 1; k < times.length; k++) {
    const gap = times[k]! - times[k - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length >= REGULAR_MIN_GAPS) {
    const medianGap = medianOf(gaps);
    const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance =
      gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length;
    const cv = meanGap > 0 ? Math.sqrt(variance) / meanGap : 0;
    if (medianGap < REGULAR_MEDIAN_GAP_MS && cv < REGULAR_CV_MAX) {
      hits.push({
        id: "regular-intervals",
        zh: `间隔机械化:中位间隔 ${Math.round(medianGap / 1000)}s、变异系数 ${cv.toFixed(2)}(真人 star 是爆发且不规则的)`,
        en: `mechanical cadence: median gap ${Math.round(medianGap / 1000)}s, CV ${cv.toFixed(2)} — human starring is bursty and irregular`,
      });
    }
  }

  // 批量连号:时间相邻的 stargazer 账号 id 近乎连续(批量注册直接刷星)。
  if (stargazerIds && stargazerIds.length > 0) {
    let chain = 1;
    let bestChain = 1;
    for (let k = 1; k < Math.min(stargazerIds.length, times.length); k++) {
      const prev = stargazerIds[k - 1];
      const curr = stargazerIds[k];
      if (
        typeof prev === "number" &&
        typeof curr === "number" &&
        curr - prev >= 1 &&
        curr - prev <= SEQ_MAX_STEP
      ) {
        chain += 1;
        bestChain = Math.max(bestChain, chain);
      } else {
        chain = 1;
      }
    }
    if (bestChain >= SEQ_MIN_CHAIN) {
      hits.push({
        id: "sequential-ids",
        zh: `批量连号:连续 ${bestChain} 个 star 来自近乎连号的账号(id 步长 ≤${SEQ_MAX_STEP})`,
        en: `sequential account ids: ${bestChain} consecutive stars from near-sequential account ids`,
      });
    }
  }

  // 昵称农场:同一天出现多个「同基础名 + 数字尾巴」账号。
  if (stargazerLogins && stargazerLogins.length > 0) {
    const byDay = new Map<string, Map<string, number>>();
    for (let k = 0; k < Math.min(stargazerLogins.length, starredAt.length); k++) {
      const login = stargazerLogins[k];
      const t = Date.parse(starredAt[k] ?? "");
      if (typeof login !== "string" || !Number.isFinite(t)) continue;
      const m = login.match(/^(.+?)(\d+)$/);
      if (!m || m[1]!.length < FARM_MIN_BASE_LEN) continue;
      const day = new Date(t).toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? new Map<string, number>();
      bucket.set(m[1]!, (bucket.get(m[1]!) ?? 0) + 1);
      byDay.set(day, bucket);
    }
    let farmBase = "";
    let farmCount = 0;
    for (const bucket of byDay.values()) {
      for (const [base, count] of bucket) {
        if (count > farmCount) {
          farmBase = base;
          farmCount = count;
        }
      }
    }
    if (farmCount >= FARM_MIN_GROUP) {
      hits.push({
        id: "login-farm-cluster",
        zh: `昵称农场:同一天 ${farmCount} 个「${farmBase}+数字」账号 star`,
        en: `name farm: ${farmCount} "${farmBase}<n>" accounts starred on the same day`,
      });
    }
  }

  return hits;
}

/**
 * 信用度 sanity 检查命中数(warn/fail),由 score.ts 传入。
 * microPatterns 为微模式证据(可选);每个命中 +12 并落一条 note。
 * locale 决定 notes 语言;zh 字符串与历史输出保持字节级一致。
 */
export function estimateWatermark(
  bursts: StarBurst[] | null,
  sanityWarns: number,
  sanityFails: number,
  timelineStatus: "covered" | "skipped" | "failed",
  locale: ScoreLocale = "zh",
  microPatterns?: StarMicroPattern[] | null,
): Watermark {
  const notes: string[] = [];
  let percent = 0;

  if (bursts === null) {
    if (locale === "en") {
      notes.push(
        timelineStatus === "skipped"
          ? "star timeline not fetched (low-star repo)"
          : timelineStatus === "failed"
            ? "star timeline unavailable (endpoint restricted or auth required); ratio signals only"
            : "star timeline coverage too short for burst detection",
      );
    } else {
      notes.push(
        timelineStatus === "skipped"
          ? "star 时间线未抓取(低星仓库,无刷量价值)"
          : timelineStatus === "failed"
            ? "star 时间线暂不可用(接口受限或需认证),仅按比例信号估计"
            : "star 时间线覆盖不足,无法做突发检测",
      );
    }
  } else if (bursts.length === 0) {
    notes.push(
      locale === "en"
        ? "star timeline steady; no burst window"
        : "star 时间线平稳,未见突发窗口",
    );
  } else {
    for (const b of bursts.slice(0, 3)) {
      if (b.level === "high") {
        percent += 30;
        notes.push(
          locale === "en"
            ? `suspected burst ${b.start}: +${b.stars} stars in one day`
            : `疑似刷量窗口 ${b.start}:单日 +${b.stars} star`,
        );
      } else {
        percent += 18;
        notes.push(
          locale === "en"
            ? `suspected spike ${b.start} ~ ${b.end}: +${b.stars} stars in 3 days`
            : `疑似堆量窗口 ${b.start} ~ ${b.end}:3 天 +${b.stars} star`,
        );
      }
    }
  }

  if (microPatterns) {
    for (const hit of microPatterns.slice(0, 3)) {
      percent += 12;
      notes.push(locale === "en" ? hit.en : hit.zh);
    }
  }

  percent += sanityFails * 12 + sanityWarns * 5;
  percent = Math.min(95, Math.round(percent));

  const level: WatermarkLevel =
    percent < 15 ? "clean" : percent < 40 ? "suspicious" : "high-risk";
  return { percent, level, notes };
}
