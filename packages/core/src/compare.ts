import type { PlatformMessage, ScoreLocale } from "./types.js";
import type { RepoScore, ScoreDimensionId } from "./score.js";
import { SCORE_DIMENSION_ORDER } from "./score.js";
import { GRADE_COLORS } from "./badge.js";

/**
 * 仓库对比:2-4 个仓库并排出对照(分项表 + 雷达 SVG)。
 * 纯函数,无网络调用;单个仓库评分失败以 N/A 列呈现,不拖垮整表。
 */

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

export type CompareEntry = {
  /** 规范化的 owner/repo(解析失败时为原始输入)。 */
  repo: string;
  /** null = 该仓库评分失败(见 error)。 */
  score: RepoScore | null;
  error?: string;
};

const DIM_ORDER = SCORE_DIMENSION_ORDER;

const STR = {
  compareTitle: { zh: "含金量对比", en: "Gold Comparison" },
  metric: { zh: "维度", en: "Metric" },
  total: { zh: "总分", en: "Total" },
  confidence: { zh: "置信度", en: "confidence" },
  watermark: { zh: "含水量", en: "watermark" },
  na: { zh: "评分失败", en: "failed" },
  footer: {
    zh: "*对比基于各自独立抓取的 GitHub 公开数据,评分口径完全一致。*",
    en: "*Each repo is scored independently from public GitHub data, under the exact same rubric.*",
  },
} as const;

function tx(s: (typeof STR)[keyof typeof STR], locale: ScoreLocale): string {
  return locale === "en" ? s.en : s.zh;
}

function scoreCell(score: RepoScore | null): string {
  if (score === null || score.total === null) return "N/A";
  const grade = score.grade ? ` · ${score.grade.label} ${score.grade.emoji}` : "";
  return `${score.total}${grade}`;
}

function dimCell(score: RepoScore | null, dim: ScoreDimensionId): string {
  if (score === null) return "N/A";
  const d = score.dimensions.find((x) => x.id === dim);
  if (!d || d.score === null) return "N/A";
  return String(Math.round(d.score));
}

/** Markdown 对比表(维度为行,仓库为列)。 */
export function formatCompareTable(
  entries: CompareEntry[],
  locale: ScoreLocale = "zh",
): PlatformMessage {
  const lines: string[] = [];
  const header = entries.map((e) => e.repo);

  lines.push(`⚖️ **${tx(STR.compareTitle, locale)}**`);
  lines.push("");
  lines.push(`| ${tx(STR.metric, locale)} | ${header.join(" | ")} |`);
  lines.push(`| --- |${entries.map(() => " --- |").join("")}`);

  lines.push(
    `| 🏅 ${tx(STR.total, locale)} | ${entries.map((e) => scoreCell(e.score)).join(" | ")} |`,
  );
  for (const dim of DIM_ORDER) {
    const meta = entries.find((e) => e.score !== null)?.score?.dimensions.find(
      (d) => d.id === dim,
    );
    const label = meta ? `${meta.emoji} ${meta.label}` : dim;
    lines.push(
      `| ${label} | ${entries.map((e) => dimCell(e.score, dim)).join(" | ")} |`,
    );
  }
  lines.push(
    `| 🔎 ${tx(STR.confidence, locale)} | ${entries.map((e) => (e.score ? `${e.score.confidence.value}` : "N/A")).join(" | ")} |`,
  );
  lines.push(
    `| 💧 ${tx(STR.watermark, locale)} | ${entries.map((e) => (e.score ? `${e.score.watermark.percent}%` : "N/A")).join(" | ")} |`,
  );

  const failures = entries.filter((e) => e.score === null);
  if (failures.length > 0) {
    lines.push("");
    for (const f of failures) {
      lines.push(`- ⚠️ ${f.repo}: ${tx(STR.na, locale)}${f.error ? ` — ${f.error}` : ""}`);
    }
  }

  lines.push("");
  lines.push(tx(STR.footer, locale));

  const markdown = lines.join("\n");
  const plain = markdown.replace(/\*\*/g, "").replace(/`/g, "");
  return { plain, markdown };
}

function polarX(cx: number, r: number, angleDeg: number): number {
  return cx + r * Math.cos((angleDeg * Math.PI) / 180);
}

function polarY(cy: number, r: number, angleDeg: number): number {
  return cy + r * Math.sin((angleDeg * Math.PI) / 180);
}

/**
 * 五维雷达 SVG(零依赖):同心五边形网格 + 每仓库一个多边形(等级配色)。
 * 维度标签取自首个成功评分的条目(已按 locale 本地化);null 分按 0 处理。
 * web 与 CLI/serverless 共用此实现(不要在适配层重写几何)。
 */
export function formatCompareRadarSvg(
  entries: CompareEntry[],
  options?: { size?: number; ariaLabel?: string },
): string {
  const size = options?.size ?? 260;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const r = size / 2 - 34;
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // 从第一个成功评分的条目取维度元信息(标签/emoji 与单仓库评分卡一致)。
  const metaSource = entries.find((e) => e.score !== null)?.score;
  const axes = DIM_ORDER.map((dim, i) => {
    const meta = metaSource?.dimensions.find((d) => d.id === dim);
    return {
      dim,
      angle: -90 + i * 72,
      label: meta ? meta.label : dim,
    };
  });

  const gridPolygons: string[] = [];
  for (const level of [0.25, 0.5, 0.75, 1]) {
    const pts = axes
      .map((a) => `${polarX(cx, r * level, a.angle).toFixed(1)},${polarY(cy, r * level, a.angle).toFixed(1)}`)
      .join(" ");
    gridPolygons.push(
      `<polygon points="${pts}" fill="none" stroke="rgba(242,239,230,0.14)" stroke-width="1"/>`,
    );
  }

  const axisLines = axes
    .map(
      (a) =>
        `<line x1="${cx}" y1="${cy}" x2="${polarX(cx, r, a.angle).toFixed(1)}" y2="${polarY(cy, r, a.angle).toFixed(1)}" stroke="rgba(242,239,230,0.14)" stroke-width="1"/>`,
    )
    .join("");

  const axisLabels = axes
    .map((a) => {
      const lx = polarX(cx, r + 16, a.angle);
      const ly = polarY(cy, r + 16, a.angle);
      const anchor = Math.abs(lx - cx) < 6 ? "middle" : lx > cx ? "start" : "end";
      return `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="rgba(242,239,230,0.75)">${esc(a.label)}</text>`;
    })
    .join("");

  const series = entries
    .map((e, idx) => {
      if (e.score === null) return "";
      const pts = axes
        .map((a) => {
          const d = e.score!.dimensions.find((x) => x.id === a.dim);
          const v = d?.score === null || d?.score === undefined ? 0 : d.score / 100;
          return `${polarX(cx, r * v, a.angle).toFixed(1)},${polarY(cy, r * v, a.angle).toFixed(1)}`;
        })
        .join(" ");
      const gradeId = e.score.grade?.id ?? "";
      const color = GRADE_COLORS[gradeId] ?? "#1de2c5";
      return `<polygon points="${pts}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2" ${idx === 0 ? "" : `stroke-dasharray="${4 + idx * 2} ${3 + idx}"`}/>`;
    })
    .join("");

  const ariaLabel = options?.ariaLabel ?? "gold comparison radar";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(ariaLabel)}">
<g>${gridPolygons.join("")}${axisLines}${axisLabels}${series}</g>
</svg>`;
}

/** 规范化对比入参:逗号/空白分隔(字符串或数组逐元素均可),去空,限量。超量抛错(带用量提示)。 */
export function parseCompareRepos(raw: string | string[]): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => s.split(/[,，\s]+/))
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (parts.length < COMPARE_MIN) {
    throw new Error(
      `compare needs ${COMPARE_MIN}-${COMPARE_MAX} repos, e.g. "owner/a owner/b"`,
    );
  }
  if (parts.length > COMPARE_MAX) {
    throw new Error(
      `compare supports at most ${COMPARE_MAX} repos (got ${parts.length})`,
    );
  }
  return parts;
}
