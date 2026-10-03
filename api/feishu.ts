import type { VercelRequest, VercelResponse } from "@vercel/node";
import { secretEqual } from "../packages/core/src/index.js";
import {
  handleFeishuChallenge,
  handleFeishuMessage,
  verifyFeishuSignature,
  FeishuAuthError,
  type FeishuEvent,
} from "../apps/bot/src/platforms/feishu.js";

// 签名验证需要原始请求体(sha256(ts+nonce+key+body)),关闭自动解析自行读取。
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as ArrayLike<number>),
    );
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
    const encryptKey = process.env.FEISHU_ENCRYPT_KEY?.trim() || undefined;
    const isProd = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");

    if (isProd && !verificationToken && !encryptKey) {
      res.status(500).json({
        error:
          "FEISHU_ENCRYPT_KEY or FEISHU_VERIFICATION_TOKEN is required in production",
      });
      return;
    }

    const rawBody = await readRawBody(req);
    let body: FeishuEvent;
    try {
      body = JSON.parse(rawBody || "{}") as FeishuEvent;
    } catch {
      res.status(400).json({ error: "invalid JSON" });
      return;
    }

    // 配置了 encrypt_key 时签名是唯一可信凭据(verification_token 可被重放)。
    if (encryptKey && !verifyFeishuSignature(rawBody, req.headers, encryptKey)) {
      res.status(401).json({ error: "invalid feishu signature" });
      return;
    }

    const challenge = handleFeishuChallenge(body, verificationToken);
    if (challenge) {
      res.status(200).json(challenge);
      return;
    }

    if (!encryptKey && verificationToken) {
      const token = body.token ?? body.header?.token;
      if (typeof token !== "string" || !secretEqual(token, verificationToken)) {
        res.status(401).json({ error: "invalid feishu token" });
        return;
      }
    }

    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) {
      res.status(500).json({ error: "missing FEISHU_APP_ID / FEISHU_APP_SECRET" });
      return;
    }

    const result = await handleFeishuMessage(body, {
      appId,
      appSecret,
      offline: process.env.GOSSIP_OFFLINE === "1",
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof FeishuAuthError) {
      res.status(401).json({ error: "invalid feishu token" });
      return;
    }
    // 与 core http-api 同口径:500 统一脱敏,细节只进服务端日志。
    console.error("[api/feishu] internal error:", err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: "internal error" });
  }
}
