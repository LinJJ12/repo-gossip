import { runGossip, toFeishuCard } from "@repo-gossip/core";

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
    if (verificationToken && body.token !== verificationToken) {
      throw new Error("feishu verification token mismatch");
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

  const target = resolveReceiveTarget(body);
  if (!target) {
    return { ok: false, error: "missing chat_id and open_id" };
  }

  const match = text.match(REPO_RE);
  if (!match) {
    await sendFeishuText(
      options,
      target,
      "Please send a GitHub repo, e.g. vercel/next.js",
    );
    return { ok: true };
  }

  const repo = match[1]!;
  try {
    await sendFeishuText(options, target, `Fetching gossip for ${repo}...`);
    const { tabloid, mode, llmError } = await runGossip({
      repo,
      offline: options.offline,
    });
    if (mode !== "llm" && llmError) {
      await sendFeishuText(options, target, `[${mode}] ${llmError}`);
    }
    await sendFeishuCard(options, target, toFeishuCard(tabloid));
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await sendFeishuText(options, target, `Gossip failed: ${error}`);
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
    throw new Error(`feishu token failed: ${data.msg ?? res.status}`);
  }
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
