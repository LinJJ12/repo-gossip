import type { ComparePayload } from "./types";

const GRADE_COLORS: Record<string, string> = {
  gold: "#d4a017",
  silver: "#8c96a5",
  bronze: "#a9683b",
  gilded: "#ff4d6d",
  tinfoil: "#5a6270",
};

const DIM_ORDER = [
  "influence",
  "activity",
  "community",
  "engineering",
  "credibility",
] as const;

type Dim = (typeof DIM_ORDER)[number];

function dimMeta(
  score: NonNullable<ComparePayload["entries"][number]["score"]>,
  dim: Dim,
) {
  return score.dimensions.find((d) => d.id === dim);
}

function dimValue(
  score: NonNullable<ComparePayload["entries"][number]["score"]> | null,
  dim: Dim,
): number | null {
  if (score === null) return null;
  const d = dimMeta(score, dim);
  return d && d.score !== null ? Math.round(d.score) : null;
}

/** 五维雷达(与 core 的 formatCompareRadarSvg 同几何):网格 + 每仓库多边形。 */
function radarSvg(entries: ComparePayload["entries"], size = 260): string {
  const cx = size / 2;
  const cy = size / 2 + 6;
  const r = size / 2 - 34;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const px = (rr: number, deg: number) =>
    (cx + rr * Math.cos((deg * Math.PI) / 180)).toFixed(1);
  const py = (rr: number, deg: number) =>
    (cy + rr * Math.sin((deg * Math.PI) / 180)).toFixed(1);

  const metaSource = entries.find((e) => e.score !== null)?.score;
  const axes = DIM_ORDER.map((dim, i) => ({
    dim,
    angle: -90 + i * 72,
    label: metaSource ? (dimMeta(metaSource, dim)?.label ?? dim) : dim,
  }));

  let svg = "";
  for (const level of [0.25, 0.5, 0.75, 1]) {
    const pts = axes.map((a) => `${px(r * level, a.angle)},${py(r * level, a.angle)}`).join(" ");
    svg += `<polygon points="${pts}" fill="none" stroke="rgba(242,239,230,0.14)" stroke-width="1"/>`;
  }
  for (const a of axes) {
    svg += `<line x1="${cx}" y1="${cy}" x2="${px(r, a.angle)}" y2="${py(r, a.angle)}" stroke="rgba(242,239,230,0.14)" stroke-width="1"/>`;
  }
  for (const a of axes) {
    const lx = Number(px(r + 16, a.angle));
    const anchor = Math.abs(lx - cx) < 6 ? "middle" : lx > cx ? "start" : "end";
    svg += `<text x="${lx}" y="${Number(py(r + 16, a.angle)) + 4}" text-anchor="${anchor}" font-size="11" fill="rgba(242,239,230,0.75)">${esc(a.label)}</text>`;
  }
  entries.forEach((e, idx) => {
    if (e.score === null) return;
    const pts = axes
      .map((a) => {
        const v = (dimValue(e.score, a.dim) ?? 0) / 100;
        return `${px(r * v, a.angle)},${py(r * v, a.angle)}`;
      })
      .join(" ");
    const color = GRADE_COLORS[e.score.grade?.id ?? ""] ?? "#1de2c5";
    svg += `<polygon points="${pts}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2" ${idx === 0 ? "" : `stroke-dasharray="${4 + idx * 2} ${3 + idx}"`}/>`;
  });

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="含金量对比雷达">${svg}</svg>`;
}

export function CompareView({ data }: { data: ComparePayload }) {
  const ok = data.entries.filter((e) => e.score !== null);
  const metaSource = ok[0]?.score ?? null;

  return (
    <article className="tabloid score-card">
      <header className="score-hero">
        <p className="masthead">验金所 · 同台竞技</p>
        <h2 className="compare-title">⚖️ 含金量对比</h2>
      </header>

      <div className="compare-grid">
        <table className="compare-table">
          <thead>
            <tr>
              <th>维度</th>
              {data.entries.map((e) => (
                <th key={e.repo}>{e.repo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="compare-total">
              <td>🏅 总分</td>
              {data.entries.map((e) => (
                <td key={e.repo}>
                  {e.score?.total ?? "N/A"}
                  {e.score?.grade ? ` · ${e.score.grade.label} ${e.score.grade.emoji}` : ""}
                </td>
              ))}
            </tr>
            {metaSource &&
              DIM_ORDER.map((dim) => {
                const meta = dimMeta(metaSource, dim);
                return (
                  <tr key={dim}>
                    <td>
                      {meta ? `${meta.emoji} ${meta.label}` : dim}
                    </td>
                    {data.entries.map((e) => {
                      const v = dimValue(e.score, dim);
                      return <td key={e.repo}>{v === null ? "N/A" : v}</td>;
                    })}
                  </tr>
                );
              })}
            <tr>
              <td>🔎 置信度</td>
              {data.entries.map((e) => (
                <td key={e.repo}>{e.score ? e.score.confidence.value : "N/A"}</td>
              ))}
            </tr>
            <tr>
              <td>💧 含水量</td>
              {data.entries.map((e) => (
                <td key={e.repo}>
                  {e.score ? `${e.score.watermark.percent}%` : "N/A"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <div
          className="compare-radar"
          aria-hidden={ok.length === 0}
          dangerouslySetInnerHTML={{ __html: radarSvg(data.entries) }}
        />
      </div>

      <ul className="compare-legend">
        {data.entries.map((e, i) => (
          <li key={e.repo}>
            <span
              className="legend-swatch"
              style={{
                borderColor:
                  GRADE_COLORS[e.score?.grade?.id ?? ""] ?? "#1de2c5",
                borderStyle: i === 0 ? "solid" : "dashed",
              }}
            />
            {e.repo}
            {e.score === null ? ` — ${e.error ?? "评分失败"}` : ""}
          </li>
        ))}
      </ul>

      <footer className="score-foot">
        对比基于各自独立抓取的 GitHub 公开数据,评分口径完全一致。
      </footer>
    </article>
  );
}
