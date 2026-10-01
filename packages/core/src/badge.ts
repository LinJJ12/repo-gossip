import type { RepoScore } from "./score.js";

/**
 * 含金量徽章:shields.io 风格的双段 SVG,零依赖,可直接嵌入 README。
 * 纯函数 —— 抓取/缓存在适配层(api/badge)完成。
 */

const GRADE_COLORS: Record<string, string> = {
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
export function formatBadgeSvg(score: RepoScore): string {
  if (score.total === null) {
    return render("含金量", "N/A", COLOR_NA);
  }
  const grade = score.grade;
  const value = grade ? `${score.total} ${grade.label}` : String(score.total);
  const color = grade ? GRADE_COLORS[grade.id] ?? COLOR_NA : COLOR_NA;
  return render("含金量", value, color);
}

/** 任何错误都输出合法的灰色 N/A 徽章(README 上永远不破图)。 */
export function badgeErrorSvg(): string {
  return render("含金量", "N/A", COLOR_NA);
}

/**
 * 解析徽章路径参数:`owner/repo.svg`(或 `owner/repo`)→ 规范 repo 字符串;
 * 非法输入返回 null。
 */
export function resolveBadgeRepoParam(
  ownerRaw: unknown,
  repoRaw: unknown,
): string | null {
  if (typeof ownerRaw !== "string" || typeof repoRaw !== "string") return null;
  const owner = ownerRaw.trim();
  const repo = repoRaw.trim().replace(/\.svg$/i, "");
  if (!owner || !repo) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return `${owner}/${repo}`;
}
