import {
  formatCompareRadarSvg,
  GRADE_COLORS,
  SCORE_DIMENSION_ORDER,
  type CompareEntry,
} from "@repo-gossip/core";
import type { ComparePayload } from "./types";

const DIM_ORDER = SCORE_DIMENSION_ORDER;

type Entry = ComparePayload["entries"][number];
type Score = NonNullable<Entry["score"]>;

function dimMeta(score: Score, dim: (typeof DIM_ORDER)[number]) {
  return score.dimensions.find((d) => d.id === dim);
}

function dimValue(score: Score | null, dim: (typeof DIM_ORDER)[number]): number | null {
  if (score === null) return null;
  const d = dimMeta(score, dim);
  return d && d.score !== null ? Math.round(d.score) : null;
}

/** 雷达几何与等级配色全部来自 core(与 CLI/serverless 同一实现)。 */
function radar(entries: Entry[]): string {
  return formatCompareRadarSvg(entries as unknown as CompareEntry[], {
    ariaLabel: "含金量对比雷达",
  });
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
          dangerouslySetInnerHTML={{ __html: radar(data.entries) }}
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
