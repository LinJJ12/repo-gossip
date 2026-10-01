import type { ScorePayload } from "./types";

const LEVEL_ICON: Record<string, string> = {
  ok: "✅",
  warn: "⚠️",
  fail: "🚨",
  unknown: "·",
};

const WATERMARK_LABEL: Record<string, string> = {
  clean: "干净",
  suspicious: "存疑",
  "high-risk": "高危",
};

/** 暗色编辑部风格的金铺检定卡:总分 + 五维条 + 健全性警示。 */
export function ScoreView({ data }: { data: ScorePayload }) {
  const { score } = data;
  const grade = score.grade;

  return (
    <article className="tabloid score-card">
      <header className="score-hero">
        <p className="masthead">验金所检定证书</p>
        <h2 className="score-total">
          {score.total === null ? "无法评分" : score.total}
          {score.total !== null && <span className="score-total-denom"> / 100</span>}
        </h2>
        {grade && (
          <p className="score-grade">
            {grade.emoji} {grade.label}
          </p>
        )}
        <p className="score-conf">
          置信度 {score.confidence.value}({score.confidence.label}) · {score.fullName}
        </p>
        <p className="score-conf">
          💧 含水量 {score.watermark.percent}%({WATERMARK_LABEL[score.watermark.level]})
        </p>
        {data.missing.length > 0 && (
          <p className="score-missing">部分信号缺失:{data.missing.join(" · ")}</p>
        )}
      </header>

      <section className="score-dims">
        {score.dimensions.map((d) => (
          <div key={d.id} className="score-dim">
            <div className="score-dim-head">
              <span className="score-dim-label">
                {d.emoji} {d.label}
              </span>
              <span className="score-dim-value">
                {d.score === null ? "N/A" : Math.round(d.score)}
              </span>
            </div>
            <div
              className="dim-bar"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={d.score === null ? undefined : Math.round(d.score)}
              aria-label={`${d.label}评分`}
            >
              <span
                className="dim-bar-fill"
                style={{ width: `${d.score === null ? 0 : Math.round(d.score)}%` }}
              />
            </div>
            {d.lines.length > 0 && (
              <ul className="score-dim-lines">
                {d.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <section className="score-sanity">
        <h3 className="score-sanity-title">健全性检查</h3>
        <ul>
          {score.sanity.map((c) => (
            <li key={c.id} className={`sanity-${c.level}`}>
              <span aria-hidden>{LEVEL_ICON[c.level]}</span> <strong>{c.label}</strong>
              {c.detail ? ` — ${c.detail}` : ""}
            </li>
          ))}
        </ul>
        {score.watermark.level !== "clean" && score.watermark.notes.length > 0 && (
          <>
            <h3 className="score-sanity-title">含水量依据</h3>
            <ul>
              {score.watermark.notes.map((n, i) => (
                <li key={i} className="sanity-warn">
                  <span aria-hidden>💧</span> {n}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <footer className="score-foot">
        评分基于 GitHub 公开数据的可解释模型(影响力/活跃度/社区/工程/信用度各 20%)。
        含水量为比例+时间线信号的统计估计,不构成对任何账号的指控。
      </footer>
    </article>
  );
}
