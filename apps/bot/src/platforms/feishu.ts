import {
  matchLooseRepo,
  parseCompareRepos,
  runCompare,
  runGossip,
  runScore,
  toFeishuCard,
} from "@repo-gossip/core";
import { busyReplyText, consumeBotUserLimit } from "../rate-guard.js";

export type FeishuEvent = {
  challenge?: string;
  type?: string;
  token?: string;
  header?: { event_type?: string; token?: string };
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      message_type?: string;
      content?: string;
    };
    sender?: { sender_id?: { open_id?: string } };
  };
};

/** 鉴权失败用专门错误类型承载,适配层据此返回 401(而非 500)。 */
export class FeishuAuthError extends Error {
  constructor(message = "feishu verification token mismatch") {
    super(message);
    this.name = "FeishuAuthError";
  }
}

export function handleFeishuChallenge(
  body: FeishuEvent,
  verificationToken?: string,
): { challenge: string } | null {
  if (body.type === "url_verification" && body.challenge) {
    if (verificationToken && body.token !== verificationToken) {
      throw new FeishuAuthError();
    }
    return { challenge: body.challenge };
  }
  return null;
}

type ReceiveTarget =
  | { id: string; idType: "chat_id" }
  | { id: string; idType: "open_id" };

function resolveReceiveTarget(body: FeishuEvent): ReceiveTarget | null {
  const chatId = body.event?.message?.chat_id;
  if (chatId) return { id: chatId, idType: "chat_id" };
  const openId = body.event?.sender?.sender_id?.open_id;
  if (openId) return { id: openId, idType: "open_id" };
  return null;
}

// 飞书事件投递是 at-least-once:同一条 message_id 的重放不去重会重复跑完整管线
// (GitHub + LLM 开销、限流额度)。进程内保留最近 500 条即可覆盖重放窗口。
const seenMessageIds = new Set<string>();
const SEEN_MESSAGE_IDS_MAX = 500;

function isDuplicateMessage(body: FeishuEvent): boolean {
  const messageId = body.event?.message?.message_id;
  if (!messageId) return false;
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.add(messageId);
  if (seenMessageIds.size > SEEN_MESSAGE_IDS_MAX) {
    // 简单淘汰:清掉一半,保持常量内存。
    for (const id of seenMessageIds) {
      seenMessageIds.delete(id);
      if (seenMessageIds.size <= SEEN_MESSAGE_IDS_MAX / 2) break;
    }
  }
  return false;
}

export async function handleFeishuMessage(
  body: FeishuEvent,
  options: {
    appId: string;
    appSecret: string;
    offline?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const contentRaw = body.event?.message?.content;
  if (!contentRaw) return { ok: true };
  if (isDuplicateMessage(body)) return { ok: true };

  let text = "";
  try {
    const parsed = JSON.parse(contentRaw) as { text?: string };
    text = parsed.text ?? contentRaw;
  } catch {
    text = contentRaw;
  }

  const target = resolveReceiveTarget(body);
  if (!target) {
    return { ok: false, error: "missing chat_id and open_id" };
  }

  const guard = consumeBotUserLimit(
    body.event?.sender?.sender_id?.open_id ?? target.id,
  );
  if (!guard.ok) {
    await sendFeishuText(options, target, busyReplyText(guard.retryAfterSec));
    return { ok: true };
  }

  // 文本命令:score / 验金 → 检定;compare / 对比 → 对比;裸链接 → 八卦小报。
  const scoreMatch = text.match(/^(?:score|验金)\s+(.+)/i);
  if (scoreMatch) {
    const repo = matchLooseRepo(scoreMatch[1]!);
    if (!repo) {
      await sendFeishuText(options, target, "请附上仓库,例如:score vercel/next.js");
      return { ok: true };
    }
    return replyScore(options, target, repo);
  }

  const compareMatch = text.match(/^(?:compare|对比)\s+(.+)/i);
  if (compareMatch) {
    let repos: string[];
    try {
      repos = parseCompareRepos(compareMatch[1]!);
    } catch (err) {
      await sendFeishuText(
        options,
        target,
        `${err instanceof Error ? err.message : String(err)}\n示例:compare vercel/next.js sindresorhus/is`,
      );
      return { ok: true };
    }
    return replyCompare(options, target, repos);
  }

  const repo = matchLooseRepo(text);
  if (!repo) {
    await sendFeishuText(
      options,
      target,
      "请发送 GitHub 仓库(如 vercel/next.js),或用命令:score <仓库> / compare <仓库1> <仓库2>",
    );
    return { ok: true };
  }
  return replyGossip(options, target, repo, options.offline ?? false);
}

async function replyGossip(
  options: { appId: string; appSecret: string; offline?: boolean },
  target: ReceiveTarget,
  repo: string,
  offline: boolean,
) {
  try {
    await sendFeishuText(options, target, `📡 正在偷看 ${repo} 的提交簿…`);
    const { tabloid, mode, llmError } = await runGossip({
      repo,
      offline,
    });
    if (mode !== "llm" && llmError) {
      await sendFeishuText(options, target, `[${mode}] ${llmError}`);
    }
    await sendFeishuCard(options, target, toFeishuCard(tabloid));
    return { ok: true } as const;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await sendFeishuText(options, target, `八卦失败:${error}`);
    return { ok: false, error } as const;
  }
}

async function replyScore(
  options: { appId: string; appSecret: string },
  target: ReceiveTarget,
  repo: string,
) {
  try {
    await sendFeishuText(options, target, `🧪 正在检定 ${repo} 的含金量…`);
    const { message, missing } = await runScore({ repo });
    await sendFeishuText(options, target, message.plain.slice(0, 3000));
    if (missing.length > 0) {
      await sendFeishuText(
        options,
        target,
        `⚠️ 缺失信号:${missing.join("、")}(置信度已降权)`,
      );
    }
    return { ok: true } as const;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await sendFeishuText(options, target, `验金失败:${error}`);
    return { ok: false, error } as const;
  }
}

async function replyCompare(
  options: { appId: string; appSecret: string },
  target: ReceiveTarget,
  repos: string[],
) {
  try {
    await sendFeishuText(options, target, `⚖️ 正在对比 ${repos.join(" vs ")}…`);
    const { message } = await runCompare({ repos });
    await sendFeishuText(options, target, message.plain.slice(0, 3000));
    return { ok: true } as const;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await sendFeishuText(options, target, `对比失败:${error}`);
    return { ok: false, error } as const;
  }
}

// ---------------------------------------------------------------------------
// 飞书 REST:tenant_access_token 进程内缓存(默认 2 小时有效,提前 5 分钟刷新)
// ---------------------------------------------------------------------------

const tenantTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getTenantToken(
  appId: string,
  appSecret: string,
): Promise<string> {
  const cached = tenantTokenCache.get(appId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const data = (await res.json()) as {
    tenant_access_token?: string;
    expire?: number;
    msg?: string;
  };
  if (!data.tenant_access_token) {
    throw new Error(`feishu token failed: ${data.msg ?? res.status}`);
  }
  const expireSec = Number.isFinite(data.expire) && data.expire! > 0
    ? data.expire!
    : 7200;
  tenantTokenCache.set(appId, {
    token: data.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, (expireSec - 300) * 1000),
  });
  return data.tenant_access_token;
}

async function sendFeishuText(
  options: { appId: string; appSecret: string },
  target: ReceiveTarget,
  text: string,
) {
  const token = await getTenantToken(options.appId, options.appSecret);
  const res = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${target.idType}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: target.id,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`feishu send text failed ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendFeishuCard(
  options: { appId: string; appSecret: string },
  target: ReceiveTarget,
  card: ReturnType<typeof toFeishuCard>,
) {
  const token = await getTenantToken(options.appId, options.appSecret);
  const res = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${target.idType}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: target.id,
        msg_type: "interactive",
        content: JSON.stringify(card.card),
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`feishu send card failed ${res.status}: ${body.slice(0, 200)}`);
  }
}
