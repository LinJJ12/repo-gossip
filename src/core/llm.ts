import type { AnalyzedGossip, Tabloid } from "../types.js";

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
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `根据以下仓库事实，生成一份「项目八卦小报」JSON。\n\n${facts}`,
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

const SYSTEM_PROMPT = `你是一个给开源仓库写「八卦小报」的中文主编。风格：夸张、幽默、有史诗感，但绝不人身攻击、不造黄赌毒、不泄露密钥内容。

必须只输出一个 JSON 对象（不要 Markdown 代码块），字段如下：
{
  "epicTitle": "电影感中文标题，带书名号，例如《深夜重构：十万行 Legacy Code 的救赎》",
  "awardsNarrative": ["颁奖词字符串数组，每条对应一个奖，可润色但不要改赢家名字"],
  "temperatureLine": "一句形容项目体温的话",
  "translations": [
    { "original": "原始提交信息", "drama": "废话文学夸张翻译", "author": "作者" }
  ],
  "easterEggLines": ["彩蛋侦探解说"],
  "closing": "一句收束的毒舌或祝福"
}

要求：
- epicTitle 要有电影海报感
- translations 针对事实表里的 notable commits，3～5 条；把「fix: 修改 bug」这种废话翻译到极致
- 如果 commits 为空，也要写出「仓库进入休眠」风格的小报
- 全程中文`;

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
      throw new Error(`LLM 请求失败 ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM 返回空内容");
    return content;
  };

  try {
    return await attempt(true);
  } catch (err) {
    // 部分兼容接口不支持 response_format，再试一次
    const msg = err instanceof Error ? err.message : "";
    if (/response_format|json_object|400/.test(msg)) {
      return await attempt(false);
    }
    throw err;
  }
}

function parseTabloidJson(raw: string, analyzed: AnalyzedGossip): Tabloid {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<Tabloid>;

  return {
    epicTitle: parsed.epicTitle || fallbackTitle(analyzed),
    awardsNarrative: Array.isArray(parsed.awardsNarrative)
      ? parsed.awardsNarrative.map(String)
      : analyzed.awards.map((a) => `${a.emoji}「${a.title}」——${a.winner}（${a.reason}）`),
    temperatureLine:
      parsed.temperatureLine ||
      `${analyzed.temperature.emoji} ${analyzed.temperature.label}`,
    translations: Array.isArray(parsed.translations)
      ? parsed.translations.map((t) => ({
          original: String(t.original ?? ""),
          drama: String(t.drama ?? ""),
          author: String(t.author ?? ""),
        }))
      : [],
    easterEggLines: Array.isArray(parsed.easterEggLines)
      ? parsed.easterEggLines.map(String)
      : analyzed.easterEggs.map(
          (e) => `${e.emoji} ${e.tag}——${e.author} 在 ${e.sha}：「${e.evidence}」`,
        ),
    closing: parsed.closing || "本期八卦到此结束，仓库的秘密比你想的多。",
    analyzed,
  };
}

function fallbackTabloid(analyzed: AnalyzedGossip): Tabloid {
  const { snapshot, temperature, awards, easterEggs, notableCommits } = analyzed;
  return {
    epicTitle: fallbackTitle(analyzed),
    awardsNarrative: awards.map(
      (a) => `${a.emoji}「${a.title}」——${a.winner}（${a.reason}）`,
    ),
    temperatureLine: `${temperature.emoji}「${temperature.label}」——近 3 天 ${temperature.commitsLast3Days} 次提交${
      temperature.daysSinceLastCommit !== null
        ? `，距上次提交 ${temperature.daysSinceLastCommit} 天`
        : ""
    }`,
    translations: notableCommits.slice(0, 5).map((c) => ({
      original: c.message,
      drama: dramatizeLocally(c.message),
      author: c.author,
    })),
    easterEggLines: easterEggs.map(
      (e) => `${e.emoji} ${e.tag}——${e.author} @ ${e.sha}：「${e.evidence}」`,
    ),
    closing:
      snapshot.commits.length === 0
        ? "本期小报无素材：仓库正在装死，请投放更多 commits。"
        : "（LLM 暂不可用，已切换本地土味翻译模式）八卦仍在继续。",
    analyzed,
  };
}

function fallbackTitle(a: AnalyzedGossip): string {
  const name = a.snapshot.ref.repo;
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

/** 无 LLM 时的土味翻译，保证 CLI 也能出活 */
export function dramatizeLocally(message: string): string {
  const m = message.trim();
  if (/^(fix|bugfix|hotfix)/i.test(m)) {
    return `开发者在键盘冒烟的夜晚，独自堵住了一处足以让产品经理半夜惊醒的致命隐患：「${m}」`;
  }
  if (/^(feat|feature|add)/i.test(m)) {
    return `一声惊雷：仓库迎来新能力。史官记下：「${m}」——后人将歌颂这一刻。`;
  }
  if (/^(refactor|重构)/i.test(m)) {
    return `在无人鼓掌的舞台上，有人默默拆掉了 legacy 的承重墙：「${m}」`;
  }
  if (/^(wip|tmp|test|misc|update|chore)/i.test(m) || m.length <= 8) {
    return `提交信息写了「${m}」。翻译：我改了东西，但我不想解释，你自己看 diff 吧。`;
  }
  if (/删除|remove|delete|cleanup|清道/i.test(m)) {
    return `清道夫出动，代码坟场又多了一排墓碑：「${m}」`;
  }
  return `当事人轻描淡写地写道「${m}」。知情人士透露：事情远没有这么简单。`;
}
