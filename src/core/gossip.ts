import { loadEnv, parseRepoRef } from "../config.js";
import type { AnalyzedGossip, PlatformMessage, Tabloid } from "../types.js";
import { analyzeSnapshot } from "./analyzer.js";
import { formatTabloid } from "./format.js";
import { createOctokit, fetchRepoSnapshot } from "./github.js";
import { dramatizeLocally, generateTabloid } from "./llm.js";

export type GossipOptions = {
  repo: string;
  sinceDays?: number;
  /** 跳过 LLM，只用本地土味翻译（方便无 Key 演示） */
  offline?: boolean;
  env?: Record<string, string | undefined>;
};

export type GossipMode = "llm" | "offline" | "fallback";

export async function runGossip(options: GossipOptions): Promise<{
  tabloid: Tabloid;
  message: PlatformMessage;
  mode: GossipMode;
  llmError?: string;
}> {
  const ref = parseRepoRef(options.repo);
  const githubToken = options.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;

  const octokit = createOctokit(githubToken);
  const snapshot = await fetchRepoSnapshot(octokit, ref, {
    sinceDays: options.sinceDays ?? 14,
  });
  const analyzed = analyzeSnapshot(snapshot);

  if (options.offline) {
    const tabloid = buildOfflineTabloid(analyzed);
    return { tabloid, message: formatTabloid(tabloid), mode: "offline" };
  }

  const env = loadEnv(options.env);
  const { tabloid, mode, llmError } = await generateTabloid(analyzed, {
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
  });

  return {
    tabloid,
    message: formatTabloid(tabloid),
    mode,
    llmError,
  };
}

export function buildOfflineTabloid(analyzed: AnalyzedGossip): Tabloid {
  const name = analyzed.snapshot.ref.repo;
  const title =
    analyzed.temperature.level === "blazing"
      ? `《${name}：连续加班的七个日夜》`
      : analyzed.temperature.level === "frozen"
        ? `《${name}：冰封仓库的漫长冬天》`
        : `《${name}：提交簿上的江湖恩怨》`;

  return {
    epicTitle: title,
    awardsNarrative: analyzed.awards.map(
      (a) => `${a.emoji}「${a.title}」——${a.winner}（${a.reason}）`,
    ),
    temperatureLine: `${analyzed.temperature.emoji}「${analyzed.temperature.label}」——近 3 天 ${analyzed.temperature.commitsLast3Days} 次提交${
      analyzed.temperature.daysSinceLastCommit !== null
        ? `，距上次提交 ${analyzed.temperature.daysSinceLastCommit} 天`
        : ""
    }`,
    translations: analyzed.notableCommits.slice(0, 5).map((c) => ({
      original: c.message,
      drama: dramatizeLocally(c.message),
      author: c.author,
    })),
    easterEggLines: analyzed.easterEggs.map(
      (e) => `${e.emoji} ${e.tag}——${e.author} @ ${e.sha}：「${e.evidence}」`,
    ),
    closing:
      analyzed.snapshot.commits.length === 0
        ? "本期小报无素材：仓库正在装死，请投放更多 commits。"
        : "本地八卦模式：没 LLM 也能把仓库骂得很花。",
    analyzed,
  };
}
