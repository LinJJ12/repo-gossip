import type { PlatformMessage, RepoRef, ScoreLocale } from "./types.js";
import {
  detectStarBursts,
  detectStarMicroPatterns,
  estimateWatermark,
  watermarkLevelLabel,
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
  /** 与 starredAt 按下标对齐的 stargazer 账号 id(微模式连号检测用;不可得为 null)。 */
  stargazerIds?: (number | null)[];
  /** 与 starredAt 按下标对齐的 stargazer login(微模式农场检测用)。 */
  stargazerLogins?: (string | null)[];
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

/** 五维展示顺序(表格行序 / 雷达轴序的唯一来源)。 */
export const SCORE_DIMENSION_ORDER: ScoreDimensionId[] = [
  "influence",
  "activity",
  "community",
  "engineering",
  "credibility",
];

const DIMENSION_META: Record<
  ScoreDimensionId,
  { zh: string; en: string; emoji: string }
> = {
  influence: { zh: "影响力", en: "Influence", emoji: "🧲" },
  activity: { zh: "活跃度", en: "Activity", emoji: "🔥" },
  community: { zh: "社区", en: "Community", emoji: "👥" },
  engineering: { zh: "工程", en: "Engineering", emoji: "🔧" },
  credibility: { zh: "信用度", en: "Credibility", emoji: "🧪" },
};

function dimensionMeta(id: ScoreDimensionId, locale: ScoreLocale) {
  const m = DIMENSION_META[id]!;
  return { label: locale === "en" ? m.en : m.zh, emoji: m.emoji };
}

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

/**
 * 缺失信号 id → 人类可读文案。missing 集合内部始终使用稳定 id(与
 * CONFIDENCE_PENALTY 键一致),仅在展示层翻译;未知 id 原样回显。
 */
export const MISSING_SIGNAL_LABEL: Record<string, { zh: string; en: string }> = {
  weeklyCommits: { zh: "commit 活跃度(stats)", en: "commit activity (stats)" },
  contributors: { zh: "贡献者列表", en: "contributors" },
  mergedPrs90d: { zh: "90 天合并 PR(Search)", en: "merged PRs 90d (search)" },
  closedIssues90d: {
    zh: "90 天关闭 issue(Search)",
    en: "closed issues 90d (search)",
  },
  openIssues: { zh: "issue 开放量(Search)", en: "open issues (search)" },
  subscribers: { zh: "watcher 数", en: "watchers" },
  releases90d: { zh: "近 90 天发版", en: "releases 90d" },
  checklist: { zh: "工程文件清单", en: "engineering checklist" },
  stargazers: { zh: "star 时间线(stargazers)", en: "star timeline (stargazers)" },
};

export function missingSignalLabel(
  id: string,
  locale: ScoreLocale = "zh",
): string {
  const label = MISSING_SIGNAL_LABEL[id];
  if (!label) return id;
  return locale === "en" ? label.en : label.zh;
}

/**
 * 评分口径集中配置(调参只改这里;行为由 test/score.test.ts 钉住)。
 * 各子信号权重仍在其构建函数内就近声明 —— 它们与证据行文案强耦合,不适合远程调参。
 */
export const SCORE_RUBRIC = {
  /** 等级分数线:≥85 足金 / ≥70 K金 / ≥55 镀金 / ≥40 掺水 / 其余贴纸。 */
  gradeThresholds: { gold: 85, silver: 70, bronze: 55, gilded: 40 },
  /** 置信度:缺失信号扣减后的下限,以及「充分/尚可/欠缺」标签分数线。 */
  confidenceFloor: 20,
  confidenceLevels: { high: 80, mid: 55 },
  /** 健全性检查启用的 star 门槛(低于即记 unknown,不扣分)。 */
  sanityStarGates: {
    engagement: 300,
    contributor: 1000,
    activityFail: 2000,
    activityWarn: 1000,
    forkRatio: 500,
  },
  /** 健全性检查阈值(与 sanityStarGates 配套的比例/数量线)。 */
  sanityThresholds: {
    engagementFail: 0.02,
    engagementWarn: 0.05,
    contributorFail: 5,
    contributorWarn: 10,
    activityFailAvg: 1,
    activityWarnAvg: 0.5,
    forkRatioFail: 0.003,
    forkRatioWarn: 0.01,
  },
} as const;

// ---------------------------------------------------------------------------
// i18n 文案字典:zh 与历史输出字节级一致;en 仅在显式选择 locale 时使用。
// ---------------------------------------------------------------------------

type Bi = { zh: string; en: string };

function tx(s: Bi, locale: ScoreLocale): string {
  return locale === "en" ? s.en : s.zh;
}

/** 纯标签类文案;带数字/语序差异的详情串在调用点内联双语。 */
const STR = {
  reportTitle: { zh: "含金量报告", en: "Gold Report" },
  unscoreable: { zh: "无法评分", en: "unscoreable" },
  confidence: { zh: "置信度", en: "confidence" },
  confHigh: { zh: "充分", en: "solid" },
  confMid: { zh: "尚可", en: "fair" },
  confLow: { zh: "不足", en: "thin" },
  sanityTitle: { zh: "健全性警示", en: "Sanity warnings" },
  watermarkEstimate: { zh: "含水量估计", en: "watermark" },
  watermarkLine: { zh: "含水量", en: "watermark" },
  allChecksPass: { zh: "各项比例检查均通过", en: "all ratio checks passed" },
  footer: {
    zh: "*含金量基于 GitHub 公开数据的可解释模型;含水量为比例+时间线信号的统计估计,不构成对任何账号的指控。*",
    en: "*The purity score is an explainable model over public GitHub data; the watermark is a statistical estimate from ratio + timeline signals, not an accusation of any account.*",
  },
  dimInfluence: { zh: "影响力", en: "Influence" },
  dimActivity: { zh: "活跃度", en: "Activity" },
  dimCommunity: { zh: "社区", en: "Community" },
  dimEngineering: { zh: "工程", en: "Engineering" },
  dimCredibility: { zh: "信用度", en: "Credibility" },
  gradeGold: { zh: "足金", en: "Solid Gold" },
  gradeSilver: { zh: "K金", en: "Alloyed" },
  gradeBronze: { zh: "镀金", en: "Plated" },
  gradeGilded: { zh: "掺水", en: "Watered" },
  gradeTinfoil: { zh: "贴纸", en: "Foil" },
  avgCommits: { zh: "周均 commit", en: "avg commits/wk" },
  momentum: { zh: "动能", en: "momentum" },
  momentumRange: { zh: "近4周/前8周", en: "last4/prior8" },
  momentumIdle: { zh: "前8周无提交", en: "prior 8w idle" },
  mergedPrs90: { zh: "90 天合并 PR", en: "PRs merged (90d)" },
  releases90: { zh: "90 天发版", en: "releases (90d)" },
  contributors: { zh: "贡献者", en: "contributors" },
  busFactorHint: {
    zh: "覆盖 50% 贡献所需人数",
    en: "people covering 50% contributions",
  },
  issueCloseRate: { zh: "issue 季度关闭率", en: "issue close rate (90d)" },
  freshPush: { zh: "30天内推送", en: "pushed ≤30d" },
  chkEngagement: { zh: "star 互动比", en: "star engagement" },
  chkStarContrib: { zh: "star/贡献者", en: "star/contributors" },
  chkHighLow: { zh: "高星低活", en: "high stars, low activity" },
  engNa: { zh: "star 较少,比例检查不适用", en: "too few stars for ratio check" },
  scOk: { zh: "贡献者规模与 star 相称", en: "contributor scale matches stars" },
  scNa: {
    zh: "贡献者数据缺失或 star 不足 1k",
    en: "contributor data missing or stars < 1k",
  },
  hlOk: { zh: "活跃度与 star 相称", en: "activity matches stars" },
  hlNa: { zh: "commit 活跃度数据缺失", en: "commit activity data missing" },
  fsNa: { zh: "star 不足 500,不适用", en: "stars < 500, n/a" },
} as const satisfies Record<string, Bi>;

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
  locale: ScoreLocale = "zh",
): { id: ScoreGradeId; label: string; emoji: string } {
  const t = SCORE_RUBRIC.gradeThresholds;
  if (total >= t.gold) return { id: "gold", label: tx(STR.gradeGold, locale), emoji: "🥇" };
  if (total >= t.silver) return { id: "silver", label: tx(STR.gradeSilver, locale), emoji: "🥈" };
  if (total >= t.bronze) return { id: "bronze", label: tx(STR.gradeBronze, locale), emoji: "🥉" };
  if (total >= t.gilded) return { id: "gilded", label: tx(STR.gradeGilded, locale), emoji: "⚠️" };
  return { id: "tinfoil", label: tx(STR.gradeTinfoil, locale), emoji: "🧻" };
}

export function confidenceFromMissing(
  missing: string[],
  locale: ScoreLocale = "zh",
): {
  value: number;
  label: string;
} {
  let value = 100;
  for (const id of missing) {
    value -= CONFIDENCE_PENALTY[id] ?? 0;
  }
  value = Math.max(SCORE_RUBRIC.confidenceFloor, value);
  const label =
    value >= SCORE_RUBRIC.confidenceLevels.high
      ? tx(STR.confHigh, locale)
      : value >= SCORE_RUBRIC.confidenceLevels.mid
        ? tx(STR.confMid, locale)
        : tx(STR.confLow, locale);
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

function buildInfluence(input: RepoScoreInput, locale: ScoreLocale): ScoreDimension {
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
  return { id: "influence", ...dimensionMeta("influence", locale), weight: SCORE_DIMENSION_WEIGHTS.influence, score, lines };
}

function buildActivity(input: RepoScoreInput, locale: ScoreLocale): ScoreDimension {
  const subs: SubScale[] = [];

  if (input.weeklyCommits !== null) {
    // 204(空仓库)时为 []:avg=0 是真实数据,不该当作"缺失"重分配权重。
    const recent = input.weeklyCommits.slice(-12);
    const avg12 = avgOf(recent);
    subs.push({
      weight: 0.4,
      score: ratioScale(avg12, 60),
      line: `${tx(STR.avgCommits, locale)} ${round1(avg12)}`,
    });
    const m = momentumOf(input.weeklyCommits);
    if (m) {
      const range = `${tx(STR.momentumRange, locale)}${
        m.ratio !== null
          ? ` ${round2(m.ratio)}×`
          : `,${locale === "en" ? " " : ""}${tx(STR.momentumIdle, locale)}`
      }`;
      subs.push({
        weight: 0.2,
        score: m.score,
        line: `${tx(STR.momentum, locale)} ${m.arrow}(${range})`,
      });
    }
  }

  if (input.mergedPrs90d !== null) {
    subs.push({
      weight: 0.25,
      score: logScale(input.mergedPrs90d, 500),
      line: `${tx(STR.mergedPrs90, locale)} ${formatCompact(input.mergedPrs90d)}`,
    });
  }

  if (input.releases90d !== null) {
    subs.push({
      weight: 0.15,
      score: ratioScale(input.releases90d, 6),
      line: `${tx(STR.releases90, locale)} ${input.releases90d}`,
    });
  }

  const { score, lines } = combineSubscales(subs);
  return { id: "activity", ...dimensionMeta("activity", locale), weight: SCORE_DIMENSION_WEIGHTS.activity, score, lines };
}

function buildCommunity(input: RepoScoreInput, locale: ScoreLocale): ScoreDimension {
  const subs: SubScale[] = [];

  if (input.contributors !== null) {
    const count = input.contributorsTruncated ? 100 : input.contributors.length;
    const countLabel = input.contributorsTruncated ? "100+" : String(input.contributors.length);
    subs.push({
      weight: 0.4,
      score: logScale(count, 120),
      line: `${tx(STR.contributors, locale)} ${countLabel}`,
    });
    const bf = busFactorOf(input.contributors);
    if (bf !== null) {
      const score = bf >= 5 ? 100 : bf === 4 ? 80 : bf === 3 ? 60 : bf === 2 ? 25 : 0;
      const flag = bf <= 2 ? " ⚠️" : "";
      subs.push({
        weight: 0.35,
        score,
        line: `Bus Factor ${bf}${flag}(${tx(STR.busFactorHint, locale)})`,
      });
    }
  }

  if (input.closedIssues90d !== null && input.openIssues !== null) {
    const denom = input.closedIssues90d + input.openIssues;
    if (denom > 0) {
      const throughput = input.closedIssues90d / denom;
      subs.push({
        weight: 0.25,
        score: ratioScale(throughput, 0.5),
        line: `${tx(STR.issueCloseRate, locale)} ${Math.round(throughput * 100)}%`,
      });
    }
    // denom === 0(仓库未启用 issue / 完全无 issue)时不输出该子信号,避免 0/0 → NaN%。
  }

  const { score, lines } = combineSubscales(subs);
  return { id: "community", ...dimensionMeta("community", locale), weight: SCORE_DIMENSION_WEIGHTS.community, score, lines };
}

function buildEngineering(input: RepoScoreInput, locale: ScoreLocale): ScoreDimension {
  const items: { id: string; label: string; weight: number; present: boolean | null }[] = [
    { id: "license", label: "license", weight: 0.25, present: licensePresent(input.licenseSpdx) },
    { id: "readme", label: "README", weight: 0.2, present: input.hasReadme },
    { id: "ci", label: "CI", weight: 0.2, present: input.hasCi },
    { id: "contributing", label: "CONTRIBUTING", weight: 0.1, present: input.hasContributing },
    { id: "security", label: "SECURITY", weight: 0.1, present: input.hasSecurity },
    { id: "fresh-push", label: tx(STR.freshPush, locale), weight: 0.15, present: pushedWithinDays(input.pushedAt, 30) },
  ];

  const subs: SubScale[] = items.map((it) => ({
    weight: it.weight,
    score: it.present === null ? null : it.present ? 100 : 0,
    line: it.present === null ? null : `${it.present ? "✅" : "❌"}${it.label}`,
  }));

  const { score, lines } = combineSubscales(subs);
  return { id: "engineering", ...dimensionMeta("engineering", locale), weight: SCORE_DIMENSION_WEIGHTS.engineering, score, lines };
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

function buildSanity(
  input: RepoScoreInput,
  locale: ScoreLocale,
): {
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

  const labelEngagement = tx(STR.chkEngagement, locale);
  const labelStarContrib = tx(STR.chkStarContrib, locale);
  const labelHighLow = tx(STR.chkHighLow, locale);

  // 1. star-engagement:star 高但 fork/issue/watcher 互动几乎为零。
  if (input.stars >= SCORE_RUBRIC.sanityStarGates.engagement) {
    const engagement =
      (input.forks + (input.openIssuesTotal ?? 0) + (input.subscribers ?? 0)) /
      input.stars;
    if (engagement < SCORE_RUBRIC.sanityThresholds.engagementFail) {
      push(
        "star-engagement",
        labelEngagement,
        "fail",
        locale === "en"
          ? `engagement/star only ${round3(engagement)}`
          : `互动信号/star 仅 ${round3(engagement)}`,
      );
    } else if (engagement < SCORE_RUBRIC.sanityThresholds.engagementWarn) {
      push(
        "star-engagement",
        labelEngagement,
        "warn",
        locale === "en"
          ? `engagement/star low (${round3(engagement)})`
          : `互动信号/star 偏低(${round3(engagement)})`,
      );
    } else {
      push(
        "star-engagement",
        labelEngagement,
        "ok",
        locale === "en"
          ? `engagement/star ${round3(engagement)}`
          : `互动信号/star ${round3(engagement)}`,
      );
    }
  } else {
    push("star-engagement", labelEngagement, "unknown", tx(STR.engNa, locale));
  }

  // 2. star/贡献者比。
  if (input.contributors !== null && input.stars >= SCORE_RUBRIC.sanityStarGates.contributor) {
    const count = input.contributors.length;
    if (!input.contributorsTruncated && count <= SCORE_RUBRIC.sanityThresholds.contributorFail) {
      push(
        "star-contributor",
        labelStarContrib,
        "fail",
        locale === "en"
          ? `${formatCompact(input.stars)} stars but only ${count} contributors`
          : `${formatCompact(input.stars)} star 仅 ${count} 位贡献者`,
      );
    } else if (!input.contributorsTruncated && count <= SCORE_RUBRIC.sanityThresholds.contributorWarn) {
      push(
        "star-contributor",
        labelStarContrib,
        "warn",
        locale === "en"
          ? `${formatCompact(input.stars)} stars but only ${count} contributors`
          : `${formatCompact(input.stars)} star 仅 ${count} 位贡献者`,
      );
    } else {
      push("star-contributor", labelStarContrib, "ok", tx(STR.scOk, locale));
    }
  } else {
    push("star-contributor", labelStarContrib, "unknown", tx(STR.scNa, locale));
  }

  // 3. 高星低活。
  if (avg12 !== null && input.stars >= SCORE_RUBRIC.sanityStarGates.activityFail && avg12 < SCORE_RUBRIC.sanityThresholds.activityFailAvg) {
    push(
      "high-star-low-activity",
      labelHighLow,
      "fail",
      locale === "en"
        ? `≥2k stars but only ${round2(avg12)} commits/wk`
        : `star ≥ 2k 但周均 commit 仅 ${round2(avg12)}`,
    );
  } else if (avg12 !== null && input.stars >= SCORE_RUBRIC.sanityStarGates.activityWarn && avg12 < SCORE_RUBRIC.sanityThresholds.activityWarnAvg) {
    push(
      "high-star-low-activity",
      labelHighLow,
      "warn",
      locale === "en"
        ? `≥1k stars but only ${round2(avg12)} commits/wk`
        : `star ≥ 1k 但周均 commit 仅 ${round2(avg12)}`,
    );
  } else if (avg12 !== null) {
    push("high-star-low-activity", labelHighLow, "ok", tx(STR.hlOk, locale));
  } else {
    push("high-star-low-activity", labelHighLow, "unknown", tx(STR.hlNa, locale));
  }

  // 4. fork/star 过低。
  if (input.stars >= SCORE_RUBRIC.sanityStarGates.forkRatio) {
    const ratio = input.forks / input.stars;
    if (ratio < SCORE_RUBRIC.sanityThresholds.forkRatioFail) {
      push(
        "fork-star",
        "fork/star",
        "fail",
        locale === "en"
          ? `fork/star only ${round4(ratio)}`
          : `fork/star 仅 ${round4(ratio)}`,
      );
    } else if (ratio < SCORE_RUBRIC.sanityThresholds.forkRatioWarn) {
      push(
        "fork-star",
        "fork/star",
        "warn",
        locale === "en"
          ? `fork/star low (${round4(ratio)})`
          : `fork/star 偏低(${round4(ratio)})`,
      );
    } else {
      push(
        "fork-star",
        "fork/star",
        "ok",
        locale === "en"
          ? `fork/star ${round3(ratio)}`
          : `fork/star ${round3(ratio)}`,
      );
    }
  } else {
    push("fork-star", "fork/star", "unknown", tx(STR.fsNa, locale));
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
        ? [tx(STR.allChecksPass, locale)]
        : [];

  return {
    dimension: {
      id: "credibility",
      ...dimensionMeta("credibility", locale),
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

export function computeRepoScore(
  input: RepoScoreInput,
  locale: ScoreLocale = "zh",
): RepoScore {
  const { dimension: credibility, checks } = buildSanity(input, locale);

  // 含水量:时序突发 + 微模式证据 + 比例异常合成,非 clean 时按 60% 折算进信用度扣分。
  const seriesCovered = (input.starredAt?.length ?? 0) > 0;
  const bursts = seriesCovered ? detectStarBursts(input.starredAt!) : null;
  const microPatterns = seriesCovered
    ? detectStarMicroPatterns(
        input.starredAt!,
        input.stargazerIds,
        input.stargazerLogins,
      )
    : null;
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
    locale,
    microPatterns,
  );
  // 微模式证据进 sanity 展示列表(先计数后追加,避免与 estimateWatermark 双重计分)。
  if (microPatterns) {
    for (const hit of microPatterns) {
      checks.push({
        id: `micro-${hit.id}`,
        label: locale === "en" ? "star pattern" : "star 模式",
        level: "warn",
        detail: locale === "en" ? hit.en : hit.zh,
      });
    }
  }
  if (watermark.level !== "clean") {
    credibility.score =
      credibility.score === null
        ? null
        : Math.max(0, credibility.score - Math.round(watermark.percent * 0.6));
    credibility.lines.unshift(
      `💧 ${tx(STR.watermarkLine, locale)} ${watermark.percent}%(${watermarkLevelLabel(watermark.level, locale)})`,
    );
  }

  const dims: ScoreDimension[] = [
    buildInfluence(input, locale),
    buildActivity(input, locale),
    buildCommunity(input, locale),
    buildEngineering(input, locale),
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
    grade: total === null ? null : gradeFor(total, locale),
    confidence: confidenceFromMissing(input.missing, locale),
    dimensions: dims,
    sanity: checks,
    watermark,
    scoredAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 排版
// ---------------------------------------------------------------------------

export function formatScoreCard(
  score: RepoScore,
  locale: ScoreLocale = "zh",
): PlatformMessage {
  const lines: string[] = [];
  const totalText =
    score.total === null
      ? tx(STR.unscoreable, locale)
      : `${score.total} / 100`;
  const gradeText = score.grade ? ` · ${score.grade.label} ${score.grade.emoji}` : "";
  const confLabel =
    score.confidence.label === "充分"
      ? tx(STR.confHigh, locale)
      : score.confidence.label === "尚可"
        ? tx(STR.confMid, locale)
        : score.confidence.label === "不足"
          ? tx(STR.confLow, locale)
          : score.confidence.label;

  lines.push(`🧪 **${tx(STR.reportTitle, locale)} · ${score.fullName}**`);
  lines.push(`🏅 **${totalText}${gradeText}** · ${tx(STR.confidence, locale)} ${score.confidence.value}(${confLabel})`);
  if (score.watermark.level !== "clean") {
    lines.push(
      `💧 ${tx(STR.watermarkEstimate, locale)} ${score.watermark.percent}%(${watermarkLevelLabel(score.watermark.level, locale)})`,
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
    lines.push(`**${tx(STR.sanityTitle, locale)}**`);
    for (const c of flags) {
      lines.push(`- ${c.level === "fail" ? "🚨" : "⚠️"} ${c.label}:${c.detail}`);
    }
  }

  lines.push("");
  lines.push(tx(STR.footer, locale));

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
