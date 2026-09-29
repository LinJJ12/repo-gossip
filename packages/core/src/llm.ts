import type { AnalyzedGossip, Tabloid } from "./types.js";

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Minimal `fetch` shape so tests can inject a stub without touching network. */
export type ChatFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_LLM_TIMEOUT_MS = 20_000;

const TABLOID_KEYS = [
  "epicTitle",
  "awardsNarrative",
  "temperatureLine",
  "translations",
  "easterEggLines",
  "closing",
] as const;

export type ParsedTabloid = {
  /** `null` when the payload yielded no usable field at all. */
  tabloid: Tabloid | null;
  /** Fields that fell back to local values instead of LLM copy. */
  degradedFields: string[];
};

export type GenerateTabloidOptions = {
  timeoutMs?: number;
  fetchImpl?: ChatFetch;
};

export async function generateTabloid(
  analyzed: AnalyzedGossip,
  llm: LlmConfig,
  options?: GenerateTabloidOptions,
): Promise<{
  tabloid: Tabloid;
  mode: "llm" | "fallback";
  llmError?: string;
  degradedFields?: string[];
}> {
  const facts = buildFactSheet(analyzed);

  try {
    const raw = await chatCompletion(
      llm,
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "根据以下仓库事实，生成一份「项目八卦小报」JSON。\n\n" +
            facts,
        },
      ],
      options,
    );
    const { tabloid, degradedFields } = safeParseTabloid(raw, analyzed);
    if (!tabloid) {
      throw new Error("LLM 返回内容中没有任何可用的小报字段");
    }
    return { tabloid, mode: "llm", degradedFields };
  } catch (err) {
    const llmError = err instanceof Error ? err.message : String(err);
    console.error("[llm]", llmError);
    return {
      tabloid: fallbackTabloid(analyzed),
      mode: "fallback",
      llmError,
    };
  }
}

const SYSTEM_PROMPT =
  "You are a Chinese tabloid editor for GitHub repos. Be funny and epic, never insult people. Output ONE JSON object only. Use EXACTLY these English keys: epicTitle, awardsNarrative, temperatureLine, translations, easterEggLines, closing. Facts may include recent PRs, issues, and releases — weave them into awardsNarrative, temperatureLine, closing, or easterEggLines when present (cite #N or release tags). translations stay commit-message oriented: each item MUST be {\"original\":\"commit message\",\"drama\":\"Chinese rewrite\",\"author\":\"name\"}. Never leave drama empty. All human-readable string values must be Chinese.";

function buildFactSheet(a: AnalyzedGossip): string {
  const {
    snapshot: s,
    temperature: t,
    awards,
    easterEggs,
    topAuthors,
    notableCommits,
    notablePulls,
    hotIssues,
    latestRelease,
  } = a;

  return JSON.stringify(
    {
      repo: s.fullName,
      description: s.description,
      language: s.language,
      stars: s.stars,
      commitCount: s.commits.length,
      pullCount: s.pulls?.length ?? 0,
      issueCount: s.issues?.length ?? 0,
      releaseCount: s.releases?.length ?? 0,
      temperature: {
        label: `${t.emoji} ${t.label}`,
        commitsLast3Days: t.commitsLast3Days,
        daysSinceLastCommit: t.daysSinceLastCommit,
      },
      awards: awards.map((x) => ({
        title: x.title,
        winner: x.winner,
        reason: x.reason,
      })),
      easterEggs: easterEggs.map((x) => ({
        tag: x.tag,
        author: x.author,
        evidence: x.evidence,
      })),
      topAuthors,
      notableCommits: notableCommits.map((c) => ({
        author: c.author,
        message: c.message,
        date: c.date,
        additions: c.additions,
        deletions: c.deletions,
      })),
      notablePulls: (notablePulls ?? []).map((p) => ({
        number: p.number,
        title: p.title,
        author: p.author,
        state: p.state,
        merged: p.merged,
      })),
      hotIssues: (hotIssues ?? []).map((i) => ({
        number: i.number,
        title: i.title,
        author: i.author,
        state: i.state,
        labels: i.labels,
      })),
      latestRelease: latestRelease
        ? {
            tag: latestRelease.tag,
            name: latestRelease.name,
            author: latestRelease.author,
            publishedAt: latestRelease.publishedAt,
            prerelease: latestRelease.prerelease,
          }
        : null,
    },
    null,
    2,
  );
}

async function chatCompletion(
  llm: LlmConfig,
  messages: ChatMessage[],
  options?: GenerateTabloidOptions,
): Promise<string> {
  const url = `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const fetchImpl =
    options?.fetchImpl ??
    ((u: string, init?: RequestInit) => fetch(u, init));

  const attempt = async (withJsonFormat: boolean) => {
    const body: Record<string, unknown> = {
      model: llm.model,
      temperature: 0.9,
      messages,
    };
    if (withJsonFormat) {
      body.response_format = { type: "json_object" };
    }

    const init: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify(body),
    };
    if (supportsTimeoutSignal()) {
      init.signal = AbortSignal.timeout(timeoutMs);
    }

    const res = await fetchImpl(url, init);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    return content;
  };

  try {
    return await attempt(true);
  } catch (err) {
    if (isAbortError(err)) throw timeoutError(timeoutMs);
    const msg = err instanceof Error ? err.message : "";
    if (/response_format|json_object/i.test(msg)) {
      try {
        return await attempt(false);
      } catch (retryErr) {
        if (isAbortError(retryErr)) throw timeoutError(timeoutMs);
        throw retryErr;
      }
    }
    throw err;
  }
}

function supportsTimeoutSignal(): boolean {
  return (
    typeof AbortSignal !== "undefined" &&
    typeof (AbortSignal as { timeout?: unknown }).timeout === "function"
  );
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || err.name === "TimeoutError";
}

function timeoutError(timeoutMs: number): Error {
  return new Error(`LLM request timed out after ${timeoutMs}ms`);
}

/** Strip markdown fences and trailing chatter. Deterministic text surgery only. */
export function normalizeRawJson(raw: string): string {
  let text = raw.replace(/^﻿/, "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  const cleaned = normalizeRawJson(raw);
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Never throws. Falls back per field, so one broken key costs that key only —
 * the whole tabloid degrades to local templates only when nothing is usable.
 */
export function safeParseTabloid(
  raw: string,
  analyzed: AnalyzedGossip,
): ParsedTabloid {
  const parsed = tryParseObject(raw);
  if (!parsed) return { tabloid: null, degradedFields: [] };
  if (!TABLOID_KEYS.some((k) => parsed[k] !== undefined)) {
    return { tabloid: null, degradedFields: [] };
  }

  const degradedFields: string[] = [];

  const epicTitle = pickNonEmptyString(parsed.epicTitle);
  if (!epicTitle) degradedFields.push("epicTitle");

  const temperatureLine = pickNonEmptyString(parsed.temperatureLine);
  if (!temperatureLine) degradedFields.push("temperatureLine");

  const closing = pickNonEmptyString(parsed.closing);
  if (!closing) degradedFields.push("closing");

  const awardsNarrative = pickStringArray(parsed.awardsNarrative);
  if (!awardsNarrative) degradedFields.push("awardsNarrative");

  const easterEggLines = pickStringArray(parsed.easterEggLines);
  if (!easterEggLines) degradedFields.push("easterEggLines");

  let translations = normalizeTranslations(parsed.translations);
  if (translations.length === 0 || translations.every((t) => !t.drama.trim())) {
    degradedFields.push("translations");
    translations = localTranslations(analyzed);
  }

  return {
    tabloid: {
      epicTitle: epicTitle ?? fallbackTitle(analyzed),
      awardsNarrative: awardsNarrative ?? localAwardsNarrative(analyzed),
      temperatureLine: temperatureLine ?? localTemperatureLine(analyzed),
      translations,
      easterEggLines: easterEggLines ?? localEasterEggLines(analyzed),
      closing: closing ?? "本期八卦到此结束。",
      analyzed,
    },
    degradedFields,
  };
}

export function normalizeTranslations(raw: unknown): {
  original: string;
  drama: string;
  author: string;
}[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const t = item as Record<string, unknown>;
      const original = pickStr(t, [
        "original",
        "commit",
        "message",
        "src",
        "source",
        "原文",
        "提交",
      ]);
      const drama = pickStr(t, [
        "drama",
        "translation",
        "rewrite",
        "gossip",
        "text",
        "翻译",
        "译文",
        "八卦",
        "漫译",
      ]);
      const author = pickStr(t, ["author", "by", "user", "作者", "作者名"]);
      if (!original && !drama) return null;
      return { original, drama, author };
    })
    .filter((x): x is { original: string; drama: string; author: string } =>
      Boolean(x),
    );
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pickStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((x) => String(x));
}

function localAwardsNarrative(a: AnalyzedGossip): string[] {
  return a.awards.map(
    (x) => `${x.emoji}「${x.title}」——${x.winner} (${x.reason})`,
  );
}

function localTemperatureLine(a: AnalyzedGossip): string {
  return `${a.temperature.emoji}「${a.temperature.label}」`;
}

function localEasterEggLines(a: AnalyzedGossip): string[] {
  return a.easterEggs.map(
    (e) => `${e.emoji} ${e.tag}——${e.author} @ ${e.sha}: 「${e.evidence}」`,
  );
}

function localTranslations(a: AnalyzedGossip) {
  return a.notableCommits.slice(0, 5).map((c) => ({
    original: c.message,
    drama: dramatizeLocally(c.message),
    author: c.author,
  }));
}

function fallbackTabloid(analyzed: AnalyzedGossip): Tabloid {
  const activityBits = activityClues(analyzed);
  const eggLines = localEasterEggLines(analyzed);
  for (const clue of activityBits) {
    if (eggLines.length >= 5) break;
    eggLines.push(clue);
  }

  return {
    epicTitle: fallbackTitle(analyzed),
    awardsNarrative: localAwardsNarrative(analyzed),
    temperatureLine: `${localTemperatureLine(analyzed)}${
      activityBits[0] ? `——${activityBits[0]}` : ""
    }`,
    translations: localTranslations(analyzed),
    easterEggLines: eggLines,
    closing:
      activityBits.length > 0
        ? `（LLM unavailable; local templates） 仍有动态素材：${activityBits.slice(0, 2).join("；")}`
        : "（LLM unavailable; local templates）",
    analyzed,
  };
}

function activityClues(a: AnalyzedGossip): string[] {
  const clues: string[] = [];
  for (const p of (a.notablePulls ?? []).slice(0, 2)) {
    clues.push(
      `PR #${p.number} 「${truncateClue(p.title)}」${p.merged ? " merged" : ""}`,
    );
  }
  for (const i of (a.hotIssues ?? []).slice(0, 2)) {
    clues.push(`Issue #${i.number} 「${truncateClue(i.title)}」`);
  }
  if (a.latestRelease?.tag) {
    clues.push(
      `发版 ${a.latestRelease.tag}${a.latestRelease.name && a.latestRelease.name !== a.latestRelease.tag ? ` 「${truncateClue(a.latestRelease.name)}」` : ""}`,
    );
  }
  return clues;
}

function truncateClue(s: string, n = 48): string {
  const t = s.replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function fallbackTitle(a: AnalyzedGossip): string {
  const name = a.snapshot.ref.repo;
  const release = a.latestRelease;
  if (release?.tag && a.temperature.level !== "frozen") {
    return `《${name}：${release.tag} 上线夜》`;
  }
  switch (a.temperature.level) {
    case "blazing":
      return `《${name}：连续加班的七个日夜》`;
    case "warm":
      return `《${name} 的微热午后》`;
    case "cool":
      return `《${name}：还能抢救一下》`;
    default:
      return `《${name}：冰封仓库的漫长冬天》`;
  }
}

export function dramatizeLocally(message: string): string {
  const m = message.trim();
  if (/^(fix|bugfix|hotfix)/i.test(m)) {
    return `开发人员在键盘冒烟的夜晚修复了致命隐患：「${m}」`;
  }
  if (/^(feat|feature|add)/i.test(m)) {
    return `仓库迎来新能力：「${m}」`;
  }
  if (/^(refactor)/i.test(m)) {
    return `有人默默拆掉了 legacy：「${m}」`;
  }
  if (/^(wip|tmp|test|misc|update|chore)/i.test(m) || m.length <= 8) {
    return `提交信息写了「${m}」。翻译：我改了，但我不想解释。`;
  }
  if (/remove|delete|cleanup/i.test(m)) {
    return `清道夫出动：「${m}」`;
  }
  return `当事人轻描淡写道「${m}」。知情人士透露：事情远没有这么简单。`;
}
