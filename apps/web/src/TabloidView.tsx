import type { TabloidPayload, TemperatureLevel } from "./types";

const TEMP_CLASS: Record<TemperatureLevel, string> = {
  blazing: "temp-blazing",
  warm: "temp-warm",
  cool: "temp-cool",
  frozen: "temp-frozen",
};

export function TabloidView({ data }: { data: TabloidPayload }) {
  const { tabloid } = data;
  const { analyzed } = tabloid;
  const temp = analyzed.temperature;
  const snap = analyzed.snapshot;

  return (
    <article className={`tabloid ${TEMP_CLASS[temp.level]}`}>
      <div className="tabloid-stamp">{temp.emoji} {temp.label}</div>

      <header className="tabloid-head">
        <p className="issue">
          项目八卦小报 · {snap.fullName}
        </p>
        <h2 className="epic">{tabloid.epicTitle}</h2>
        <p className="meta">
          <span>★ {snap.stars.toLocaleString()}</span>
          <span>{snap.language ?? "未知语言"}</span>
          <span>近窗 {snap.commits.length} 次提交</span>
          <span>近 3 天 {temp.commitsLast3Days} 次</span>
        </p>
        {snap.description && (
          <p className="desc">{snap.description}</p>
        )}
      </header>

      <section className="block temp-block">
        <h3>项目体温</h3>
        <p className="lead">{tabloid.temperatureLine}</p>
      </section>

      {(tabloid.awardsNarrative.length > 0 || analyzed.awards.length > 0) && (
        <section className="block">
          <h3>颁奖典礼</h3>
          {tabloid.awardsNarrative.length > 0 ? (
            <ul className="award-list">
              {tabloid.awardsNarrative.map((line, i) => (
                <li key={i}>
                  <div>
                    <p className="award-title">{line}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="award-list">
              {analyzed.awards.map((a) => (
                <li key={a.id}>
                  <span className="award-emoji">{a.emoji}</span>
                  <div>
                    <p className="award-title">
                      「{a.title}」——{a.winner}
                    </p>
                    <p className="award-reason">{a.reason}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tabloid.translations.length > 0 && (
        <section className="block">
          <h3>提交信翻译</h3>
          <ul className="trans-list">
            {tabloid.translations.map((t, i) => (
              <li key={`${t.original}-${i}`}>
                <code>{t.original}</code>
                <p>
                  <span className="arrow">→</span> {t.drama}
                  {t.author ? <cite> ——{t.author}</cite> : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tabloid.easterEggLines.length > 0 && (
        <section className="block eggs">
          <h3>彩蛋侦探</h3>
          <ul>
            {tabloid.easterEggLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {analyzed.topAuthors.length > 0 && (
        <section className="block authors">
          <h3>出镜名单</h3>
          <div className="author-row">
            {analyzed.topAuthors.slice(0, 6).map((a) => (
              <span key={a.name}>
                {a.name}
                <em>{a.commits}</em>
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="closing">{tabloid.closing}</p>
    </article>
  );
}
