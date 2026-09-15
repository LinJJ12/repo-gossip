import { loadEnv, parseRepoRef } from "./config.js";
import type { AnalyzedGossip, PlatformMessage, Tabloid } from "./types.js";
import { analyzeSnapshot } from "./analyzer.js";
import { formatTabloid } from "./format.js";
import { createOctokit, fetchRepoSnapshot } from "./github.js";
import { dramatizeLocally, generateTabloid } from "./llm.js";

export type GossipOptions = {
  repo: string;
  sinceDays?: number;
  /** Skip LLM; use local template translations */
  offline?: boolean;
  env?: Record<string, string | undefined>;
};

export type GossipMode = "llm" | "offline" | "fallback";

export async function runGossip(options: GossipOptions): Promise<{
  tabloid: Tabloid;
  message: PlatformMessage;
  mode: GossipMode;
  llmError?: string;
  warnings?: string[];
}> {
  const ref = parseRepoRef(options.repo);
  const githubToken = options.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;

  const octokit = createOctokit(githubToken);
  const snapshot = await fetchRepoSnapshot(octokit, ref, {
    sinceDays: options.sinceDays ?? 14,
  });
  const analyzed = analyzeSnapshot(snapshot);
  const warnings: string[] = [];
  if (snapshot.statsIncomplete) {
    warnings.push(
      "部分提交详情拉取失败，增删行统计可能不完整（可能因 GitHub 限额或权限）",
    );
  }
  if (snapshot.activityIncomplete) {
    warnings.push(
      "部分 PR / Issue / Release 拉取失败，活动信号可能不完整（可能因 GitHub 限额或权限）",
    );
  }

  const apiKey = options.env?.LLM_API_KEY ?? process.env.LLM_API_KEY;
  const wantOffline = options.offline || !apiKey;

  if (wantOffline) {
    const tabloid = buildOfflineTabloid(analyzed);
    return {
      tabloid,
      message: formatTabloid(tabloid),
      mode: "offline",
      llmError: options.offline
        ? undefined
        : "missing LLM_API_KEY; used local templates",
      warnings: warnings.length ? warnings : undefined,
    };
  }

  const env = loadEnv(options.env);
  const { tabloid, mode, llmError } = await generateTabloid(analyzed, {
    apiKey: apiKey as string,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
  });

  return {
    tabloid,
    message: formatTabloid(tabloid),
    mode,
    llmError,
    warnings: warnings.length ? warnings : undefined,
  };
}

export function buildOfflineTabloid(analyzed: AnalyzedGossip): Tabloid {
  const name = analyzed.snapshot.ref.repo;
  const release = analyzed.latestRelease;
  const title =
    release?.tag && analyzed.temperature.level !== "frozen"
      ? `\u300a${name}\uff1a${release.tag} \u4e0a\u7ebf\u591c\u300b`
      : analyzed.temperature.level === "blazing"
        ? `\u300a${name}\uff1a\u8fde\u7eed\u52a0\u73ed\u7684\u4e03\u4e2a\u65e5\u591c\u300b`
        : analyzed.temperature.level === "frozen"
          ? `\u300a${name}\uff1a\u51b0\u5c01\u4ed3\u5e93\u7684\u6f2b\u957f\u51ac\u5929\u300b`
          : `\u300a${name}\uff1a\u63d0\u4ea4\u7c3f\u4e0a\u7684\u6c5f\u6e56\u6069\u6028\u300b`;

  const activityLines = offlineActivityLines(analyzed);
  const eggLines = analyzed.easterEggs.map(
    (e) =>
      `${e.emoji} ${e.tag}\u2014\u2014${e.author} @ ${e.sha}\uff1a\u300c${e.evidence}\u300d`,
  );
  for (const line of activityLines) {
    if (eggLines.length >= 5) break;
    eggLines.push(line);
  }

  const activityHint =
    activityLines.length > 0
      ? `\u2014\u2014${activityLines[0]}`
      : "";

  let closing: string;
  if (
    (analyzed.snapshot.commits?.length ?? 0) === 0 &&
    activityLines.length === 0
  ) {
    closing =
      "\u672c\u671f\u5c0f\u62a5\u65e0\u7d20\u6750\uff1a\u4ed3\u5e93\u6b63\u5728\u88c5\u6b7b\u3002";
  } else if (activityLines.length > 0) {
    closing = `\u672c\u5730\u516b\u5366\u6a21\u5f0f\u5df2\u542f\u7528\u3002\u672c\u671f\u8fd8\u5438\u5165\uff1a${activityLines.slice(0, 2).join("\uff1b")}\u3002`;
  } else {
    closing = "\u672c\u5730\u516b\u5366\u6a21\u5f0f\u5df2\u542f\u7528\u3002";
  }

  return {
    epicTitle: title,
    awardsNarrative: analyzed.awards.map(
      (a) =>
        `${a.emoji}\u300c${a.title}\u300d\u2014\u2014${a.winner} (${a.reason})`,
    ),
    temperatureLine: `${analyzed.temperature.emoji}\u300c${analyzed.temperature.label}\u300d\u2014\u2014 last3d ${analyzed.temperature.commitsLast3Days}${
      analyzed.temperature.daysSinceLastCommit !== null
        ? `, daysSinceLast=${analyzed.temperature.daysSinceLastCommit}`
        : ""
    }${activityHint}`,
    translations: analyzed.notableCommits.slice(0, 5).map((c) => ({
      original: c.message,
      drama: dramatizeLocally(c.message),
      author: c.author,
    })),
    easterEggLines: eggLines,
    closing,
    analyzed,
  };
}

function offlineActivityLines(a: AnalyzedGossip): string[] {
  const lines: string[] = [];
  for (const p of (a.notablePulls ?? []).slice(0, 2)) {
    lines.push(
      `\uD83D\uDD17 PR #${p.number} \u300c${truncateOneLine(p.title, 48)}\u300d${p.merged ? " \u5df2\u5408\u5e76" : ""}`,
    );
  }
  for (const i of (a.hotIssues ?? []).slice(0, 2)) {
    lines.push(
      `\uD83D\uDCDD Issue #${i.number} \u300c${truncateOneLine(i.title, 48)}\u300d`,
    );
  }
  if (a.latestRelease?.tag) {
    lines.push(
      `\uD83D\uDE80 Release ${a.latestRelease.tag}${
        a.latestRelease.name && a.latestRelease.name !== a.latestRelease.tag
          ? ` \u300c${truncateOneLine(a.latestRelease.name, 40)}\u300d`
          : ""
      }`,
    );
  }
  return lines;
}

function truncateOneLine(s: string, n: number): string {
  const t = s.replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}\u2026`;
}
