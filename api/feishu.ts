import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  handleFeishuChallenge,
  handleFeishuMessage,
  type FeishuEvent,
} from "../apps/bot/src/platforms/feishu.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as FeishuEvent;
  const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
  const isProd = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");

  try {
    if (isProd && !verificationToken) {
      res.status(500).json({
        error: "FEISHU_VERIFICATION_TOKEN is required in production",
      });
      return;
    }

    const challenge = handleFeishuChallenge(body, verificationToken);
    if (challenge) {
      res.status(200).json(challenge);
      return;
    }

    if (verificationToken) {
      const token = body.token ?? body.header?.token;
      if (token !== verificationToken) {
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
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
