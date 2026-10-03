import type { RepoScore } from "./score.js";
import type { ScoreLocale } from "./types.js";

/**
 * 含金量徽章:shields.io 风格的双段 SVG,零依赖,可直接嵌入 README。
 * 纯函数 —— 抓取/缓存在适配层(api/badge)完成。
 */

const BADGE_LABEL: Record<ScoreLocale, string> = { zh: "含金量", en: "Gold" };

/** 等级 → SVG 填色(徽章与雷达图共用)。 */
export const GRADE_COLORS: Record<string, string> = {
  gold: "#d4a017",
  silver: "#8c96a5",
  bronze: "#a9683b",
  gilded: "#ff4d6d",
  tinfoil: "#5a6270",
};

const COLOR_NA = "#5a6270";
const COLOR_LEFT = "#151a22";

/** 粗略文本宽度:CJK ≈ 11px,字母数字 ≈ 6.5px,其它 ≈ 5px(Verdana 11px)。 */
export function badgeTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80) width += 11;
    else if (/[A-Za-z0-9]/.test(ch)) width += 6.5;
    else width += 5;
  }
  return Math.ceil(width);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(label: string, value: string, valueColor: string): string {
  const left = badgeTextWidth(label) + 12;
  const right = badgeTextWidth(value) + 12;
  const total = left + right;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${left}" height="20" fill="${COLOR_LEFT}"/><rect x="${left}" width="${right}" height="20" fill="${valueColor}"/><rect width="${total}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${left / 2}" y="14">${esc(label)}</text><text x="${left + right / 2}" y="14">${esc(value)}</text></g>
</svg>`;
}

/** 评分徽章;无法评分(total null)时右侧为灰色 N/A。 */
export function formatBadgeSvg(score: RepoScore, locale: ScoreLocale = "zh"): string {
  const label = BADGE_LABEL[locale]!;
  if (score.total === null) {
    return render(label, "N/A", COLOR_NA);
  }
  const grade = score.grade;
  const value = grade ? `${score.total} ${grade.label}` : String(score.total);
  const color = grade ? GRADE_COLORS[grade.id] ?? COLOR_NA : COLOR_NA;
  return render(label, value, color);
}

/** 任何错误都输出合法的灰色 N/A 徽章(README 上永远不破图)。 */
export function badgeErrorSvg(locale: ScoreLocale = "zh"): string {
  return render(BADGE_LABEL[locale]!, "N/A", COLOR_NA);
}

// ---------------------------------------------------------------------------
// shields.io endpoint JSON:字段对齐 shields /endpoint/ schema,用户一行
// `img.shields.io/endpoint?url=…` 即可挂徽章,由 shields 负责渲染与缓存分发。
// ---------------------------------------------------------------------------

const ENDPOINT_NA_COLOR = "lightgrey";

/** 评分 → shields endpoint JSON 字符串(color 为无 # 的十六进制/命名色)。 */
export function formatBadgeEndpoint(
  score: RepoScore,
  locale: ScoreLocale = "zh",
): string {
  const label = BADGE_LABEL[locale]!;
  if (score.total === null) {
    return badgeEndpointError(locale);
  }
  const grade = score.grade;
  const message = grade
    ? `${score.total} ${grade.label} ${grade.emoji}`
    : String(score.total);
  const color = grade ? GRADE_COLORS[grade.id]?.slice(1) ?? ENDPOINT_NA_COLOR : ENDPOINT_NA_COLOR;
  return JSON.stringify({ schemaVersion: 1, label, message, color });
}

/** 端点失败同样输出合法 N/A JSON(shields 侧永不显示 invalid response)。 */
export function badgeEndpointError(locale: ScoreLocale = "zh"): string {
  return JSON.stringify({
    schemaVersion: 1,
    label: BADGE_LABEL[locale]!,
    message: "N/A",
    color: ENDPOINT_NA_COLOR,
  });
}

/**
 * 解析徽章路径参数:`owner/repo.svg` / `owner/repo.json` / `owner/repo`
 * → 规范 repo 字符串与响应格式;非法输入返回 null。
 */
export function resolveBadgeRequest(
  ownerRaw: unknown,
  repoRaw: unknown,
): { owner: string; repo: string; format: "svg" | "json" } | null {
  if (typeof ownerRaw !== "string" || typeof repoRaw !== "string") return null;
  const owner = ownerRaw.trim();
  let repo = repoRaw.trim();
  let format: "svg" | "json" = "svg";
  if (/\.json$/i.test(repo)) {
    format = "json";
    repo = repo.replace(/\.json$/i, "");
  } else {
    repo = repo.replace(/\.svg$/i, "");
  }
  if (!owner || !repo) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  // 与 isGithubFullName 同口径:拒绝 ".."、首尾点等纯 404 输入。
  if (repo.startsWith(".") || repo.endsWith(".")) return null;
  return { owner, repo, format };
}

/**
 * 解析徽章路径参数:`owner/repo.svg`(或 `owner/repo`)→ 规范 repo 字符串;
 * 非法输入返回 null。(仅需要 repo 字符串的旧调用方使用。)
 */
export function resolveBadgeRepoParam(
  ownerRaw: unknown,
  repoRaw: unknown,
): string | null {
  const resolved = resolveBadgeRequest(ownerRaw, repoRaw);
  return resolved ? `${resolved.owner}/${resolved.repo}` : null;
}
