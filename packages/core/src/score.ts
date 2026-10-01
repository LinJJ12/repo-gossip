import type { PlatformMessage, RepoRef } from "./types.js";
import {
  detectStarBursts,
  estimateWatermark,
  WATERMARK_LEVEL_LABEL,
  type Watermark,
} from "./watermark.js";

/**
 * 含金量评分引擎 — 纯函数,无网络调用。
 *
 * 五维:影响力 / 活跃度 / 社区 / 工程 / 信用度,各 0-100,默认等权 0.2。
 * 每个维度由子信号加权合成;子信号缺失(数据抓取失败/不适用)时权重在维度内
 * 重分配,维度整体缺失时权重在五维间重分配。所有数字都来自 GitHub 公开数据,
 * 证据行(中文)与分数同源,LLM(后续接入)只允许解读、不允许改写。
 *
 * 指标定义参考:
 * - Bus Factor / Contributor Absence Factor — CHAOSS
 * - 工程检查清单 — OpenSSF Scorecard 子集
 * - 分项+加权结构 — npms.io / libraries.io SourceRank
 */

export type RepoScoreInput = {
  ref: RepoRef;
  fullName: string;
  description: string | null;
  language: string | null;
  createdAt: string | null;
  pushedAt: string | null;
  archived: boolean;
  stars: number;
  forks: number;
  /** Watchers(subscribers_count);抓取失败为 null。 */
  subscribers: number | null;
  /** repos.get 的 open_issues_count(含 PR),仅作 engagement 近似。 */
  openIssuesTotal: number | null;
  /** Search API 的纯 issue 开放量(不含 PR);null = 搜索失败。 */
  openIssues: number | null;
  licenseSpdx: string | null;
  /** 近 52 周每周 commit 数(旧→新);null = stats 端点降级。 */
  weeklyCommits: number[] | null;
  /** 贡献者首页(≤100);null = 抓取失败。 */
  contributors: { login: string; contributions: number }[] | null;
  contributorsTruncated: boolean;
  /** 近 90 天合并 PR 数(Search count);null = 搜索失败。 */
  mergedPrs90d: number | null;
  /** 近 90 天已关闭 issue 数(Search count);null = 搜索失败。 */
  closedIssues90d: number | null;
  /** 近 90 天 release 数;null = 抓取失败。 */
  releases90d: number | null;
  hasCi: boolean | null;
  hasReadme: boolean | null;
  hasContributing: boolean | null;
  hasSecurity: boolean | null;
  /**
   * stargazer 时间线(starred_at,仅 star ≥ 500 的仓库抓取,≤400 个)。
   * null = 抓取失败或未抓取(见 starTimelineSkipped)。
   */
  starredAt: string[] | null;
  /** true = 因 star 不足主动跳过时间线抓取(不算缺失信号)。 */
  starTimelineSkipped: boolean;
  /** 抓取阶段确认缺失的信号 id(用于置信度扣减)。 */
  missing: string[];
};

export type ScoreDimensionId =
  | "influence"
  | "activity"
  | "community"
  | "engineering"
  | "credibility";

export type ScoreGradeId = "gold" | "silver" | "bronze" | "gilded" | "tinfoil";

export type SanityLevel = "ok" | "warn" | "fail" | "unknown";

export type SanityCheck = { id: string; label: string; level: SanityLevel; detail: string };

export type ScoreDimension = {
  id: ScoreDimensionId;
  label: string;
  emoji: string;
  /** 重分配后的有效权重(总和仍为 1)。 */
  weight: number;
  score: number | null;
  lines: string[];
};

export type RepoScore = {
  ref: RepoRef;
  fullName: string;
  total: number | null;
  grade: { id: ScoreGradeId; label: string; emoji: string } | null;
  confidence: { value: number; label: string };
  dimensions: ScoreDimension[];
  sanity: SanityCheck[];
  /** 含水量估计;时间线未覆盖且无比例异常时为 clean/低值,永不指控具体账号。 */
  watermark: Watermark;
  scoredAt: string;
};

/** 五维基础权重(等权起步,集中在此便于调整)。 */
export const SCORE_DIMENSION_WEIGHTS: Record<ScoreDimensionId, number> = {
  influence: 0.2,
  activity: 0.2,
  community: 0.2,
  engineering: 0.2,
  credibility: 0.2,
};

const DIMENSION_META: Record<ScoreDimensionId, { label: string; emoji: string }> = {
  influence: { label: "影响力", emoji: "🧲" },
  activity: { label: "活跃度", emoji: "🔥" },
  community: { label: "社区", emoji: "👥" },
  engineering: { label: "工程", emoji: "🔧" },
  credibility: { label: "信用度", emoji: "🧪" },
};

const CONFIDENCE_PENALTY: Record<string, number> = {
  weeklyCommits: 15,
  contributors: 15,
  mergedPrs90d: 10,
  closedIssues90d: 10,
  openIssues: 5,
  subscribers: 5,
  releases90d: 5,
  checklist: 10,
  stargazers: 5,
};

const SANITY_PENALTY: Record<Exclude<SanityLevel, "ok" | "unknown">, number> = {
  warn: 15,
  fail: 35,
};

// ---------------------------------------------------------------------------
// 数值工具(导出以便单测)
// ---------------------------------------------------------------------------

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** 对数刻度:0 → 0,≥cap → 100,中间按 log10 比例。 */
export function logScale(value: number, cap: number): number {
  if (!Number.isFinite(value) || value <= 0 || cap <= 0) return 0;
  return clamp01(Math.log10(1 + value) / Math.log10(1 + cap)) * 100;
}

/** 线性刻度:≥cap → 100。 */
export function ratioScale(value: number, cap: number): number {
  if (!Number.isFinite(value) || cap <= 0) return 0;
  return clamp01(value / cap) * 100;
}

/**
 * fork/star 比:健康区间 [0.05, 0.6] 满分;过低(只收藏不使用)线性走低,
 * 过高(fork 工厂)缓慢衰减。
 */
export function forkStarScore(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 0) return 0;
  if (ratio >= 0.05 && ratio <= 0.6) return 100;
  if (ratio < 0.05) return clamp01(ratio / 0.05) * 100;
  return Math.max(50, 100 - (ratio - 0.6) * 80);
}

/**
 * Bus Factor(CHAOSS Contributor Absence Factor):覆盖 50% 贡献量所需的
 * 最少贡献者人数。空列表返回 null。
 */
export function busFactorOf(
  contributors: { contributions: number }[],
): number | null {
  const sorted = contributors
    .map((c) => c.contributions)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  if (sorted.length === 0) return null;
  const total = sorted.reduce((s, n) => s + n, 0);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i]!;
    if (acc >= total / 2) return i + 1;
  }
  return sorted.length;
}

export type Momentum = { ratio: number | null; score: number; arrow: string };

/** 近 4 周均值 vs 前 8 周均值。 */
export function momentumOf(weeklyCommits: number[]): Momentum | null {
  if (weeklyCommits.length < 12) return null;
  const last4 = weeklyCommits.slice(-4);
  const prior8 = weeklyCommits.slice(-12, -4);
  const avg = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
  const a = avg(last4);
  const b = avg(prior8);
  if (b <= 0) {
    return a > 0
      ? { ratio: null, score: 90, arrow: "↑" }
      : { ratio: 0, score: 0, arrow: "→" };
  }
  const ratio = a / b;
  const score = ratio >= 1 ? 60 + Math.min(40, (ratio - 1) * 40) : ratio * 60;
  const arrow = ratio >= 1.15 ? "↑" : ratio <= 0.85 ? "↓" : "→";
  return { ratio, score: clamp01(score / 100) * 100, arrow };
}

export function gradeFor(
  total: number,
): { id: ScoreGradeId; label: string; emoji: string } {
  if (total >= 85) return { id: "gold", label: "足金", emoji: "🥇" };
  if (total >= 70) return { id: "silver", label: "K金", emoji: "🥈" };
  if (total >= 55) return { id: "bronze", label: "镀金", emoji: "🥉" };
  if (total >= 40) return { id: "gilded", label: "掺水", emoji: "⚠️" };
  return { id: "tinfoil", label: "贴纸", emoji: "🧻" };
}

export function confidenceFromMissing(missing: string[]): {
  value: number;
  label: string;
} {
  let value = 100;
  for (const id of missing) {
    value -= CONFIDENCE_PENALTY[id] ?? 0;
  }
  value = Math.max(20, value);
  const label = value >= 80 ? "充分" : value >= 55 ? "尚可" : "不足";
  return { value, label };
}

// ---------------------------------------------------------------------------
// 子信号 → 维度
// ---------------------------------------------------------------------------

type SubScale = {
  weight: number;
  score: number | null;
  line: string | null;
};

function combineSubscales(subs: SubScale[]): { score: number | null; lines: string[] } {
  let acc = 0;
  let weightSum = 0;
  const lines: string[] = [];
  for (const s of subs) {
    if (s.score === null) continue;
    acc += s.score * s.weight;
    weightSum += s.weight;
    if (s.line) lines.push(s.line);
  }
  if (weightSum <= 0) return { score: null, lines: [] };
  return { score: acc / weightSum, lines };
}

function avgOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, n) => s + n, 0) / xs.length;
}

function buildInfluence(input: RepoScoreInput): ScoreDimension {
  const subs: SubScale[] = [];

  subs.push({
    weight: 0.5,
    score: logScale(input.stars, 100_000),
    line: `⭐ ${formatCompact(input.stars)}`,
  });

  if (input.stars > 0) {
    const ratio = input.forks / input.stars;
    subs.push({
      weight: 0.2,
      score: forkStarScore(ratio),
      line: `🍴 fork/star ${ratio.toFixed(2)}`,
    });
  }

  if (input.subscribers !== null) {
    subs.push({
      weight: 0.3,
      score: logScale(input.subscribers, 5_000),
      line: `👁 watcher ${formatCompact(input.subscribers)}`,
    });
  }

  const { score, lines } = combineSubscales(subs);
  return { id: "influence", ...DIMENSION_META.influence, weight: SCORE_DIMENSION_WEIGHTS.influence, score, lines };
}

function buildActivity(input: RepoScoreInput): ScoreDimension {
  const subs: SubScale[] = [];

  if (input.weeklyCommits !== null) {
    // 204(空仓库)时为 []:avg=0 是真实数据,不该当作"缺失"重分配权重。
    const recent = input.weeklyCommits.slice(-12);
    const avg12 = avgOf(recent);
    subs.push({
      weight: 0.4,
      score: ratioScale(avg12, 60),
      line: `周均 commit ${round1(avg12)}`,
    });
    const m = momentumOf(input.weeklyCommits);
    if (m) {
      subs.push({
        weight: 0.2,
        score: m.score,
        line: `动能 ${m.arrow}(近4周/前8周${m.ratio !== null ? ` ${round2(m.ratio)}×` : ",前8周无提交"})`,
      });
    }
  }

  if (input.mergedPrs90d !== null) {
    subs.push({
      weight: 0.25,
      score: logScale(input.mergedPrs90d, 500),
      line: `90 天合并 PR ${formatCompact(input.mergedPrs90d)}`,
    });
  }

  if (input.releases90d !== null) {
    subs.push({
      weight: 0.15,
      score: ratioScale(input.releases90d, 6),
      line: `90 天发版 ${input.releases90d}`,
    });
  }

  const { score, lines } = combineSubscales(subs);
  return { id: "activity", ...DIMENSION_META.activity, weight: SCORE_DIMENSION_WEIGHTS.activity, score, lines };
}

function buildCommunity(input: RepoScoreInput): ScoreDimension {
  const subs: SubScale[] = [];

  if (input.contributors !== null) {
    const count = input.contributorsTruncated ? 100 : input.contributors.length;
    const countLabel = input.contributorsTruncated ? "100+" : String(input.contributors.length);
    subs.push({
      weight: 0.4,
      score: logScale(count, 120),
      line: `贡献者 ${countLabel}`,
    });
    const bf = busFactorOf(input.contributors);
    if (bf !== null) {
      const score = bf >= 5 ? 100 : bf === 4 ? 80 : bf === 3 ? 60 : bf === 2 ? 25 : 0;
      const flag = bf <= 2 ? " ⚠️" : "";
      subs.push({
        weight: 0.35,
        score,
        line: `Bus Factor ${bf}${flag}(覆盖 50% 贡献所需人数)`,
      });
    }
  }

  if (input.closedIssues90d !== null && input.openIssues !== null) {
    const throughput =
      input.closedIssues90d / (input.closedIssues90d + input.openIssues);
    subs.push({
      weight: 0.25,
      score: ratioScale(throughput, 0.5),
      line: `issue 季度关闭率 ${Math.round(throughput * 100)}%`,
    });
  }

  const { score, lines } = combineSubscales(subs);
  return { id: "community", ...DIMENSION_META.community, weight: SCORE_DIMENSION_WEIGHTS.community, score, lines };
}

function buildEngineering(input: RepoScoreInput): ScoreDimension {
  const items: { id: string; label: string; weight: number; present: boolean | null }[] = [
    { id: "license", label: "license", weight: 0.25, present: licensePresent(input.licenseSpdx) },
    { id: "readme", label: "README", weight: 0.2, present: input.hasReadme },
    { id: "ci", label: "CI", weight: 0.2, present: input.hasCi },
    { id: "contributing", label: "CONTRIBUTING", weight: 0.1, present: input.hasContributing },
    { id: "security", label: "SECURITY", weight: 0.1, present: input.hasSecurity },
    { id: "fresh-push", label: "30天内推送", weight: 0.15, present: pushedWithinDays(input.pushedAt, 30) },
  ];

  const subs: SubScale[] = items.map((it) => ({
    weight: it.weight,
    score: it.present === null ? null : it.present ? 100 : 0,
    line: it.present === null ? null : `${it.present ? "✅" : "❌"}${it.label}`,
  }));

  const { score, lines } = combineSubscales(subs);
  return { id: "engineering", ...DIMENSION_META.engineering, weight: SCORE_DIMENSION_WEIGHTS.engineering, score, lines };
}

function licensePresent(spdx: string | null): boolean | null {
  if (spdx === null) return false;
  if (spdx === "NOASSERTION") return true; // 有 LICENSE 文件但无法识别,按有文件计
  return spdx !== "";
}

function pushedWithinDays(pushedAt: string | null, days: number): boolean | null {
  if (!pushedAt) return null;
  const t = Date.parse(pushedAt);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t <= days * 86_400_000;
}

// ---------------------------------------------------------------------------
// 信用度:比例健全性检查(扣分制)。P1 由 star 时间线突发检测增强。
// ---------------------------------------------------------------------------

function buildSanity(input: RepoScoreInput): {
  dimension: ScoreDimension;
  checks: SanityCheck[];
  penalty: number;
} {
  const checks: SanityCheck[] = [];
  let penalty = 0;

  function push(id: string, label: string, level: SanityLevel, detail: string) {
    checks.push({ id, label, level, detail });
    if (level === "warn" || level === "fail") penalty += SANITY_PENALTY[level];
  }

  const avg12 =
    input.weeklyCommits !== null
      ? avgOf(input.weeklyCommits.slice(-12))
      : null;

  // 1. star-engagement:star 高但 fork/issue/watcher 互动几乎为零。
  if (input.stars >= 300) {
    const engagement =
      (input.forks + (input.openIssuesTotal ?? 0) + (input.subscribers ?? 0)) /
      input.stars;
    if (engagement < 0.02) {
      push("star-engagement", "star 互动比", "fail", `互动信号/star 仅 ${round3(engagement)}`);
    } else if (engagement < 0.05) {
      push("star-engagement", "star 互动比", "warn", `互动信号/star 偏低(${round3(engagement)})`);
    } else {
      push("star-engagement", "star 互动比", "ok", `互动信号/star ${round3(engagement)}`);
    }
  } else {
    push("star-engagement", "star 互动比", "unknown", "star 较少,比例检查不适用");
  }

  // 2. star/贡献者比。
  if (input.contributors !== null && input.stars >= 1000) {
    const count = input.contributors.length;
    if (!input.contributorsTruncated && count <= 5) {
      push("star-contributor", "star/贡献者", "fail", `${formatCompact(input.stars)} star 仅 ${count} 位贡献者`);
    } else if (!input.contributorsTruncated && count <= 10) {
      push("star-contributor", "star/贡献者", "warn", `${formatCompact(input.stars)} star 仅 ${count} 位贡献者`);
    } else {
      push("star-contributor", "star/贡献者", "ok", "贡献者规模与 star 相称");
    }
  } else {
    push("star-contributor", "star/贡献者", "unknown", "贡献者数据缺失或 star 不足 1k");
  }

  // 3. 高星低活。
  if (avg12 !== null && input.stars >= 2000 && avg12 < 1) {
    push("high-star-low-activity", "高星低活", "fail", `star ≥ 2k 但周均 commit 仅 ${round2(avg12)}`);
  } else if (avg12 !== null && input.stars >= 1000 && avg12 < 0.5) {
    push("high-star-low-activity", "高星低活", "warn", `star ≥ 1k 但周均 commit 仅 ${round2(avg12)}`);
  } else if (avg12 !== null) {
    push("high-star-low-activity", "高星低活", "ok", "活跃度与 star 相称");
  } else {
    push("high-star-low-activity", "高星低活", "unknown", "commit 活跃度数据缺失");
  }

  // 4. fork/star 过低。
  if (input.stars >= 500) {
    const ratio = input.forks / input.stars;
    if (ratio < 0.003) {
      push("fork-star", "fork/star", "fail", `fork/star 仅 ${round4(ratio)}`);
    } else if (ratio < 0.01) {
      push("fork-star", "fork/star", "warn", `fork/star 偏低(${round4(ratio)})`);
    } else {
      push("fork-star", "fork/star", "ok", `fork/star ${round3(ratio)}`);
    }
  } else {
    push("fork-star", "fork/star", "unknown", "star 不足 500,不适用");
  }

  const evaluated = checks.filter((c) => c.level !== "unknown");
  const flags = checks.filter((c) => c.level === "warn" || c.level === "fail");
  const score = evaluated.length === 0 ? null : Math.max(0, 100 - penalty);
  // 维度行只放警示;全通过时一行带过(完整清单由 sanity 区块/尽调视图展示)。
  const lines =
    flags.length > 0
      ? flags.map(
          (c) => `${c.level === "fail" ? "🚨" : "⚠️"} ${c.label}:${c.detail}`,
        )
      : evaluated.length > 0
        ? ["各项比例检查均通过"]
        : [];

  return {
    dimension: {
      id: "credibility",
      ...DIMENSION_META.credibility,
      weight: SCORE_DIMENSION_WEIGHTS.credibility,
      score,
      lines,
    },
    checks,
    penalty,
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function computeRepoScore(input: RepoScoreInput): RepoScore {
  const { dimension: credibility, checks } = buildSanity(input);

  // 含水量:时序突发 + 比例异常合成,非 clean 时按 60% 折算进信用度扣分。
  const seriesCovered = (input.starredAt?.length ?? 0) > 0;
  const bursts = seriesCovered ? detectStarBursts(input.starredAt!) : null;
  const warnCount = checks.filter((c) => c.level === "warn").length;
  const failCount = checks.filter((c) => c.level === "fail").length;
  const timelineStatus: "covered" | "skipped" | "failed" = seriesCovered
    ? "covered"
    : input.starTimelineSkipped
      ? "skipped"
      : "failed";
  const watermark = estimateWatermark(
    bursts,
    warnCount,
    failCount,
    timelineStatus,
  );
  if (watermark.level !== "clean") {
    credibility.score =
      credibility.score === null
        ? null
        : Math.max(0, credibility.score - Math.round(watermark.percent * 0.6));
    credibility.lines.unshift(
      `💧 含水量 ${watermark.percent}%(${WATERMARK_LEVEL_LABEL[watermark.level]})`,
    );
  }

  const dims: ScoreDimension[] = [
    buildInfluence(input),
    buildActivity(input),
    buildCommunity(input),
    buildEngineering(input),
    credibility,
  ];

  // 维度整体缺失 → 权重重分配到其余维度。
  const available = dims.filter((d) => d.score !== null);
  if (available.length > 0) {
    const baseSum = available.reduce((s, d) => s + SCORE_DIMENSION_WEIGHTS[d.id], 0);
    for (const d of dims) {
      d.weight =
        d.score === null
          ? 0
          : SCORE_DIMENSION_WEIGHTS[d.id] / baseSum;
    }
  }

  const total =
    available.length === 0
      ? null
      : Math.round(available.reduce((s, d) => s + d.weight * (d.score ?? 0), 0));

  return {
    ref: input.ref,
    fullName: input.fullName,
    total,
    grade: total === null ? null : gradeFor(total),
    confidence: confidenceFromMissing(input.missing),
    dimensions: dims,
    sanity: checks,
    watermark,
    scoredAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 排版
// ---------------------------------------------------------------------------

export function formatScoreCard(score: RepoScore): PlatformMessage {
  const lines: string[] = [];
  const totalText =
    score.total === null
      ? "无法评分"
      : `${score.total} / 100`;
  const gradeText = score.grade ? ` · ${score.grade.label} ${score.grade.emoji}` : "";

  lines.push(`🧪 **含金量报告 · ${score.fullName}**`);
  lines.push(`🏅 **${totalText}${gradeText}** · 置信度 ${score.confidence.value}(${score.confidence.label})`);
  if (score.watermark.level !== "clean") {
    lines.push(
      `💧 含水量估计 ${score.watermark.percent}%(${WATERMARK_LEVEL_LABEL[score.watermark.level]})`,
    );
  }

  for (const d of score.dimensions) {
    const scoreText = d.score === null ? "N/A" : String(Math.round(d.score));
    const evidence = d.lines.length ? ` —— ${d.lines.join(" · ")}` : "";
    lines.push(`- ${d.emoji} **${d.label} ${scoreText}**${evidence}`);
  }

  const flags = score.sanity.filter((c) => c.level === "warn" || c.level === "fail");
  if (flags.length > 0) {
    lines.push("");
    lines.push("**健全性警示**");
    for (const c of flags) {
      lines.push(`- ${c.level === "fail" ? "🚨" : "⚠️"} ${c.label}:${c.detail}`);
    }
  }

  lines.push("");
  lines.push(
    "*含金量基于 GitHub 公开数据的可解释模型;含水量为比例+时间线信号的统计估计,不构成对任何账号的指控。*",
  );

  const markdown = lines.join("\n");
  const plain = markdown.replace(/\*\*/g, "").replace(/`/g, "");
  return { plain, markdown };
}

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${round1(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1000) return `${round1(n / 1000)}k`;
  return String(Math.round(n));
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function round3(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function round4(n: number): string {
  return (Math.round(n * 10000) / 10000).toString();
}
