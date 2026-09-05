import type { AnalyzedGossip, Tabloid } from "./types.js";

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function generateTabloid(
  analyzed: AnalyzedGossip,
  llm: LlmConfig,
): Promise<{ tabloid: Tabloid; mode: "llm" | "fallback"; llmError?: string }> {
  const facts = buildFactSheet(analyzed);

  try {
    const raw = await chatCompletion(llm, [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "\u6839\u636e\u4ee5\u4e0b\u4ed3\u5e93\u4e8b\u5b9e\uff0c\u751f\u6210\u4e00\u4efd\u300c\u9879\u76ee\u516b\u5366\u5c0f\u62a5\u300dJSON\u3002\n\n" +
          facts,
      },
    ]);
    return { tabloid: parseTabloidJson(raw, analyzed), mode: "llm" };
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
  "You are a Chinese tabloid editor for GitHub repos. Be funny and epic, never insult people. Output ONE JSON object only. Use EXACTLY these English keys: epicTitle, awardsNarrative, temperatureLine, translations, easterEggLines, closing. Each translations item MUST be {\"original\":\"commit message\",\"drama\":\"Chinese rewrite\",\"author\":\"name\"}. Never leave drama empty. All human-readable string values must be Chinese.";

function buildFactSheet(a: AnalyzedGossip): string {
  const { snapshot: s, temperature: t, awards, easterEggs, topAuthors, notableCommits } =
    a;

  return JSON.stringify(
    {
      repo: s.fullName,
      description: s.description,
      language: s.language,
      stars: s.stars,
      commitCount: s.commits.length,
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
    },
    null,
    2,
  );
}

async function chatCompletion(
  llm: LlmConfig,
  messages: ChatMessage[],
): Promise<string> {
  const url = `${llm.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const attempt = async (withJsonFormat: boolean) => {
    const body: Record<string, unknown> = {
      model: llm.model,
      temperature: 0.9,
      messages,
    };
    if (withJsonFormat) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify(body),
    });

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
    const msg = err instanceof Error ? err.message : "";
    if (/response_format|json_object/i.test(msg)) {
      return await attempt(false);
    }
    throw err;
  }
}

function parseTabloidJson(raw: string, analyzed: AnalyzedGossip): Tabloid {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cleaned = (fenced?.[1] ?? raw).trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonText =
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  let translations = normalizeTranslations(parsed.translations);
  if (translations.length === 0 || translations.every((t) => !t.drama.trim())) {
    translations = analyzed.notableCommits.slice(0, 5).map((c) => ({
      original: c.message,
      drama: dramatizeLocally(c.message),
      author: c.author,
    }));
  }

  return {
    epicTitle: String(parsed.epicTitle || fallbackTitle(analyzed)),
    awardsNarrative: Array.isArray(parsed.awardsNarrative)
      ? parsed.awardsNarrative.map(String)
      : analyzed.awards.map(
          (a) =>
            `${a.emoji}\u300c${a.title}\u300d\u2014\u2014${a.winner} (${a.reason})`,
        ),
    temperatureLine: String(
      parsed.temperatureLine ||
        `${analyzed.temperature.emoji} ${analyzed.temperature.label}`,
    ),
    translations,
    easterEggLines: Array.isArray(parsed.easterEggLines)
      ? parsed.easterEggLines.map(String)
      : analyzed.easterEggs.map(
          (e) =>
            `${e.emoji} ${e.tag}\u2014\u2014${e.author} @ ${e.sha}: \u300c${e.evidence}\u300d`,
        ),
    closing: String(
      parsed.closing || "\u672c\u671f\u516b\u5366\u5230\u6b64\u7ed3\u675f\u3002",
    ),
    analyzed,
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
        "\u539f\u6587",
        "\u63d0\u4ea4",
      ]);
      const drama = pickStr(t, [
        "drama",
        "translation",
        "rewrite",
        "gossip",
        "text",
        "\u7ffb\u8bd1",
        "\u8bd1\u6587",
        "\u516b\u5366",
        "\u6da8\u8bd1",
      ]);
      const author = pickStr(t, [
        "author",
        "by",
        "user",
        "\u4f5c\u8005",
        "\u4f5c\u8005\u540d",
      ]);
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

function fallbackTabloid(analyzed: AnalyzedGossip): Tabloid {
  const offline = {
    epicTitle: fallbackTitle(analyzed),
    awardsNarrative: analyzed.awards.map(
      (a) =>
        `${a.emoji}\u300c${a.title}\u300d\u2014\u2014${a.winner} (${a.reason})`,
    ),
    temperatureLine: `${analyzed.temperature.emoji}\u300c${analyzed.temperature.label}\u300d`,
    translations: analyzed.notableCommits.slice(0, 5).map((c) => ({
      original: c.message,
      drama: dramatizeLocally(c.message),
      author: c.author,
    })),
    easterEggLines: analyzed.easterEggs.map(
      (e) =>
        `${e.emoji} ${e.tag}\u2014\u2014${e.author} @ ${e.sha}: \u300c${e.evidence}\u300d`,
    ),
    closing:
      "\uff08LLM unavailable; local templates\uff09",
    analyzed,
  };
  return offline;
}

function fallbackTitle(a: AnalyzedGossip): string {
  const name = a.snapshot.ref.repo;
  switch (a.temperature.level) {
    case "blazing":
      return `\u300a${name}\uff1a\u8fde\u7eed\u52a0\u73ed\u7684\u4e03\u4e2a\u65e5\u591c\u300b`;
    case "warm":
      return `\u300a${name} \u7684\u5fae\u70ed\u5348\u540e\u300b`;
    case "cool":
      return `\u300a${name}\uff1a\u8fd8\u80fd\u62a2\u6551\u4e00\u4e0b\u300b`;
    default:
      return `\u300a${name}\uff1a\u51b0\u5c01\u4ed3\u5e93\u7684\u6f2b\u957f\u51ac\u5929\u300b`;
  }
}

export function dramatizeLocally(message: string): string {
  const m = message.trim();
  if (/^(fix|bugfix|hotfix)/i.test(m)) {
    return `\u5f00\u53d1\u8005\u5728\u952e\u76d8\u5192\u70df\u7684\u591c\u665a\u4fee\u590d\u4e86\u81f4\u547d\u9690\u60a3\uff1a\u300c${m}\u300d`;
  }
  if (/^(feat|feature|add)/i.test(m)) {
    return `\u4ed3\u5e93\u8fce\u6765\u65b0\u80fd\u529b\uff1a\u300c${m}\u300d`;
  }
  if (/^(refactor)/i.test(m)) {
    return `\u6709\u4eba\u9ed8\u9ed8\u62c6\u6389\u4e86 legacy\uff1a\u300c${m}\u300d`;
  }
  if (/^(wip|tmp|test|misc|update|chore)/i.test(m) || m.length <= 8) {
    return `\u63d0\u4ea4\u4fe1\u606f\u5199\u4e86\u300c${m}\u300d\u3002\u7ffb\u8bd1\uff1a\u6211\u6539\u4e86\uff0c\u4f46\u6211\u4e0d\u60f3\u89e3\u91ca\u3002`;
  }
  if (/remove|delete|cleanup/i.test(m)) {
    return `\u6e05\u9053\u592b\u51fa\u52a8\uff1a\u300c${m}\u300d`;
  }
  return `\u5f53\u4e8b\u4eba\u8f7b\u63cf\u6de1\u5199\u9053\u300c${m}\u300d\u3002\u77e5\u60c5\u4eba\u58eb\u900f\u9732\uff1a\u4e8b\u60c5\u8fdc\u6ca1\u6709\u8fd9\u4e48\u7b80\u5355\u3002`;
}
