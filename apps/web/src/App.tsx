import { useState, type FormEvent } from "react";
import { TabloidView } from "./TabloidView";
import { SAMPLE_TABLOID } from "./sample";
import type { GossipMode, TabloidPayload } from "./types";

const EXAMPLES = ["sindresorhus/is", "facebook/react", "vercel/next.js"];

const MODE_LABEL: Record<GossipMode, string> = {
  llm: "LLM 八卦模式",
  offline: "本地土味模式（未调 LLM）",
  fallback: "LLM 失败，已回退本地模板",
};

export function App() {
  const [repo, setRepo] = useState("pbakaus/impeccable");
  const [days, setDays] = useState(14);
  const [useLlm, setUseLlm] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TabloidPayload | null>(SAMPLE_TABLOID);
  const [isSample, setIsSample] = useState(true);

  async function generate(target = repo) {
    const trimmed = target.trim();
    if (!trimmed) {
      setError("先丢一个仓库链接过来");
      return;
    }
    setLoading(true);
    setError(null);
    setIsSample(false);
    try {
      const res = await fetch("/api/gossip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: trimmed,
          offline: !useLlm,
          days,
        }),
      });
      const json = (await res.json()) as TabloidPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "八卦失败");
      setData(json);
      setRepo(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function showSample() {
    setError(null);
    setIsSample(true);
    setData(SAMPLE_TABLOID);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void generate();
  }

  const mode = data?.mode;

  return (
    <div className="page">
      <div className="grain" aria-hidden />
      <div className="glow glow-a" aria-hidden />
      <div className="glow glow-b" aria-hidden />

      <header className="hero">
        <p className="masthead">夜班编辑室出品</p>
        <h1 className="brand">
          repo
          <span className="brand-slash">/</span>
          gossip
        </h1>
        <p className="tagline">
          丢进仓库链接，拿走一份项目八卦小报——不是 changelog，是气氛组。
        </p>

        <form className="compose" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="repo">
            GitHub 仓库
          </label>
          <input
            id="repo"
            className="repo-input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo 或 GitHub URL"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="compose-row">
            <label className="days">
              回溯
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={3}>3 天</option>
                <option value={7}>7 天</option>
                <option value={14}>14 天</option>
                <option value={30}>30 天</option>
              </select>
            </label>
            <label className="days llm-toggle">
              <input
                type="checkbox"
                checked={useLlm}
                onChange={(e) => setUseLlm(e.target.checked)}
              />
              调用 LLM
            </label>
            <button className="go" type="submit" disabled={loading}>
              {loading
                ? useLlm
                  ? "主编正在写稿…"
                  : "正在翻提交簿…"
                : "出报"}
            </button>
          </div>
        </form>

        <div className="examples">
          <button type="button" className="chip chip-sample" onClick={showSample}>
            看样报
          </button>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              disabled={loading}
              onClick={() => void generate(ex)}
            >
              {ex}
            </button>
          ))}
        </div>

        {error && (
          <p className="error">
            {error}
            {/rate limit/i.test(error) && (
              <>
                {" "}
                ——可在 <code>.env</code> 填 <code>GITHUB_TOKEN</code> 后重启，或先点「看样报」。
              </>
            )}
          </p>
        )}
      </header>

      <main className="stage">
        {loading && (
          <div className="loading-panel" role="status">
            <div className="spinner" />
            <p>
              {useLlm
                ? "编辑室连线 LLM，正在把提交写成八卦…"
                : "编辑正在连夜翻 commit history…"}
            </p>
          </div>
        )}

        {!loading && data && (
          <>
            {isSample && (
              <p className="sample-banner">
                当前为样报预览 · 勾选「调用 LLM」后点「出报」拉取真实仓库
              </p>
            )}
            {!isSample && mode && (
              <p
                className={
                  mode === "llm" ? "sample-banner" : "sample-banner warn-banner"
                }
              >
                {MODE_LABEL[mode]}
                {data.llmError ? ` · ${data.llmError}` : ""}
              </p>
            )}
            {!isSample && data.warnings && data.warnings.length > 0 && (
              <p className="sample-banner warn-banner">
                {data.warnings.join(" · ")}
              </p>
            )}
            <TabloidView data={data} />
          </>
        )}
      </main>

      <footer className="foot">
        <span>默认调用 .env 里的 LLM · 可关掉「调用 LLM」用本地模板</span>
        <span>CLI：npm run gossip -- owner/repo</span>
      </footer>
    </div>
  );
}
