import { runGossip } from "../core/gossip.js";
import { toFeishuCard } from "../core/format.js";

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

const REPO_RE =
  /(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/;

export function handleFeishuChallenge(
  body: FeishuEvent,
  verificationToken?: string,
): { challenge: string } | null {
  if (body.type === "url_verification" && body.challenge) {
    if (verificationToken && body.token && body.token !== verificationToken) {
      throw new Error("飞书 verification token 不匹配");
    }
    return { challenge: body.challenge };
  }
  return null;
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

  let text = "";
  try {
    const parsed = JSON.parse(contentRaw) as { text?: string };
    text = parsed.text ?? contentRaw;
  } catch {
    text = contentRaw;
  }

  const match = text.match(REPO_RE);
  if (!match) {
    await sendFeishuText(
      options,
      body.event?.message?.chat_id,
      "请发送 GitHub 仓库，例如：vercel/next.js",
    );
    return { ok: true };
  }

  const repo = match[1]!;
  const chatId = body.event?.message?.chat_id;
  try {
    await sendFeishuText(options, chatId, `📡 正在偷看 ${repo} 的提交簿…`);
    const { tabloid } = await runGossip({ repo, offline: options.offline });
    await sendFeishuCard(options, chatId, toFeishuCard(tabloid));
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await sendFeishuText(options, chatId, `八卦失败：${error}`);
    return { ok: false, error };
  }
}

async function getTenantToken(appId: string, appSecret: string): Promise<string> {
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
    msg?: string;
  };
  if (!data.tenant_access_token) {
    throw new Error(`飞书 token 获取失败：${data.msg ?? res.status}`);
  }
  return data.tenant_access_token;
}

async function sendFeishuText(
  options: { appId: string; appSecret: string },
  chatId: string | undefined,
  text: string,
) {
  if (!chatId) return;
  const token = await getTenantToken(options.appId, options.appSecret);
  await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });
}

async function sendFeishuCard(
  options: { appId: string; appSecret: string },
  chatId: string | undefined,
  card: ReturnType<typeof toFeishuCard>,
) {
  if (!chatId) return;
  const token = await getTenantToken(options.appId, options.appSecret);
  await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card.card),
    }),
  });
}
