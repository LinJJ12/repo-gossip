import { useState, type FormEvent } from "react";
import { TabloidView } from "./TabloidView";
import { ScoreView } from "./ScoreView";
import { CompareView } from "./CompareView";
import {
  formatSavedAt,
  loadHistoryFromStorage,
  slimGossipData,
  type HistoryEntry,
  upsertHistoryInStorage,
} from "./history";
import { missingSignalLabel } from "@repo-gossip/core";
import { SAMPLE_TABLOID } from "./sample";
import type {
  ComparePayload,
  GossipMode,
  ScorePayload,
  TabloidPayload,
} from "./types";

const EXAMPLES = ["sindresorhus/is", "facebook/react", "vercel/next.js"];

const MODE_LABEL: Record<GossipMode, string> = {
  llm: "LLM 八卦模式",
  offline: "本地土味模式（未调 LLM）",
  fallback: "LLM 失败，已回退本地模板",
};

type Intent = "gossip" | "score";

function isGossipMode(mode: unknown): mode is GossipMode {
  return mode === "llm" || mode === "offline" || mode === "fallback";
}

export function App() {
  const [repo, setRepo] = useState("pbakaus/impeccable");
  const [days, setDays] = useState(14);
  const [useLlm, setUseLlm] = useState(true);
  const [intent, setIntent] = useState<Intent>("gossip");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TabloidPayload | null>(SAMPLE_TABLOID);
  const [scoreData, setScoreData] = useState<ScorePayload | null>(null);
  const [compareData, setCompareData] = useState<ComparePayload | null>(null);
  const [isSample, setIsSample] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    loadHistoryFromStorage(),
  );

  async function generate(target = repo) {
    const trimmed = target.trim();
    if (!trimmed) {
      setError("先丢一个仓库链接过来");
      return;
    }
    setLoading(true);
    setError(null);
    setIsSample(false);
    setHistoryOpen(false);
    try {
      const isScore = intent === "score";
      // 验金模式下输入 2-4 个仓库(逗号/空白分隔)→ 对比模式
      const multiRepos =
        isScore && /[,，\s]+/.test(trimmed) ? trimmed.split(/[,，\s]+/).filter(Boolean) : null;
      const res = await fetch("/api/gossip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: trimmed,
          offline: !useLlm,
          days,
          ...(isScore && multiRepos ? { mode: "compare", repos: multiRepos } : {}),
          ...(isScore && !multiRepos ? { mode: "score" } : {}),
        }),
      });
      const json = (await res.json()) as
        | (TabloidPayload & { error?: string; kind?: string })
        | (ScorePayload & { error?: string })
        | (ComparePayload & { error?: string });
      if (!res.ok) throw new Error((json as { error?: string }).error || "请求失败");
      if (isScore && (json as { kind?: string }).kind === "compare") {
        setCompareData(json as ComparePayload);
        setScoreData(null);
        setRepo(trimmed);
      } else if (isScore) {
        if ((json as { kind?: string }).kind !== "score") {
          throw new Error("评分响应格式异常");
        }
        setScoreData(json as ScorePayload);
        setCompareData(null);
        setRepo(trimmed);
      } else {
        setData(json as TabloidPayload);
        setRepo(trimmed);
        setHistory(upsertHistoryInStorage(trimmed, json as TabloidPayload));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function showSample() {
    setError(null);
    setIsSample(true);
    setHistoryOpen(false);
    setIntent("gossip");
    setData(SAMPLE_TABLOID);
  }

  function toggleHistory() {
    if (loading) return;
    setError(null);
    setHistory(loadHistoryFromStorage());
    setHistoryOpen((open) => !open);
  }

  function openHistoryEntry(entry: HistoryEntry) {
    const slim = slimGossipData(entry.data);
    if (!slim?.tabloid?.analyzed) {
      setError("这条缓存已损坏或丢失");
      setHistory(loadHistoryFromStorage());
      return;
    }
    setError(null);
    setIsSample(false);
    setHistoryOpen(false);
    setRepo(entry.repo);
    setData(slim);
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
          丢进仓库链接，拿走一份项目八卦小报——或者一份含金量检定报告。
        </p>

        <div className="intent-switch" role="tablist" aria-label="输出模式">
          <button
            type="button"
            role="tab"
            aria-selected={intent === "gossip"}
            className={`intent-chip${intent === "gossip" ? " is-active" : ""}`}
            disabled={loading}
            onClick={() => setIntent("gossip")}
          >
            📰 出报
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={intent === "score"}
            className={`intent-chip${intent === "score" ? " is-active" : ""}`}
            disabled={loading}
            onClick={() => setIntent("score")}
          >
            🧪 验金
          </button>
        </div>

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
                disabled={intent === "score"}
              />
              调用 LLM
            </label>
            <button className="go" type="submit" disabled={loading}>
              {loading
                ? intent === "score"
                  ? "验金师正在称量…"
                  : useLlm
                    ? "主编正在写稿…"
                    : "正在翻提交簿…"
                : intent === "score"
                  ? "验金"
                  : "出报"}
            </button>
          </div>
        </form>

        <div className="examples">
          <button
            type="button"
            className="chip chip-sample"
            disabled={loading}
            onClick={showSample}
          >
            看样报
          </button>
          <button
            type="button"
            className={`chip chip-recent${historyOpen ? " is-active" : ""}`}
            aria-expanded={historyOpen}
            aria-controls="recent-history"
            disabled={loading}
            onClick={toggleHistory}
          >
            最近
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

        <div
          id="recent-history"
          className="recent-history"
          role="list"
          hidden={!historyOpen}
        >
          {history.length === 0 ? (
            <p className="recent-history-empty">还没有缓存的小报</p>
          ) : (
            history.map((entry) => {
              const title = entry.epicTitle || entry.repo;
              const time = formatSavedAt(entry.savedAt);
              return (
                <button
                  key={`${entry.repo}-${entry.savedAt}`}
                  type="button"
                  className="recent-history-item"
                  role="listitem"
                  disabled={loading}
                  onClick={() => openHistoryEntry(entry)}
                >
                  <span className="recent-history-item__repo">{entry.repo}</span>
                  <span className="recent-history-item__title">{title}</span>
                  {time ? (
                    <span className="recent-history-item__time">{time}</span>
                  ) : null}
                </button>
              );
            })
          )}
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
              {intent === "score"
                ? "验金师正在称量 star、commit 与贡献者…"
                : useLlm
                  ? "编辑室连线 LLM，正在把提交写成八卦…"
                  : "编辑正在连夜翻 commit history…"}
            </p>
          </div>
        )}

        {!loading && intent === "score" && compareData && (
          <>
            <CompareView data={compareData} />
          </>
        )}

        {!loading && intent === "score" && !compareData && scoreData && (
          <>
            {scoreData.missing.length > 0 && (
              <p className="sample-banner warn-banner">
                部分信号缺失,评分置信度受限:{scoreData.missing.map((id) => missingSignalLabel(id)).join(" · ")}
              </p>
            )}
            <ScoreView data={scoreData} />
          </>
        )}

        {!loading && intent === "score" && !compareData && !scoreData && (
          <div className="loading-panel score-empty" role="note">
            <p>
              丢一个仓库链接,点「验金」——五维含金量检定报告马上出炉。
              <br />
              也可以一次填 2-4 个仓库(逗号分隔)进行对比。
            </p>
          </div>
        )}

        {!loading && intent === "gossip" && data && (
          <>
            {isSample && (
              <p className="sample-banner">
                当前为样报预览 · 勾选「调用 LLM」后点「出报」拉取真实仓库
              </p>
            )}
            {!isSample && isGossipMode(mode) && (
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
        <span>出报走 LLM/本地模板 · 验金走纯数据评分,不调 LLM</span>
        <span>CLI:npm run gossip -- owner/repo(加 --score 验金)</span>
      </footer>
    </div>
  );
}
