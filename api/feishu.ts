import type { VercelRequest, VercelResponse } from "@vercel/node";
import { secretEqual } from "../packages/core/src/index.js";
import {
  handleFeishuChallenge,
  handleFeishuMessage,
  FeishuAuthError,
  type FeishuEvent,
} from "../apps/bot/src/platforms/feishu.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body = req.body as FeishuEvent;
    const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
    const isProd = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");

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
    res.status(500).json({ error: "internal error" });
  }
}
