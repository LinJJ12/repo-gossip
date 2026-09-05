import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  handleFeishuChallenge,
  handleFeishuMessage,
  type FeishuEvent,
} from "../src/platforms/feishu.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as FeishuEvent;

  try {
    const challenge = handleFeishuChallenge(
      body,
      process.env.FEISHU_VERIFICATION_TOKEN,
    );
    if (challenge) {
      res.status(200).json(challenge);
      return;
    }

    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) {
      res.status(500).json({ error: "缺少 FEISHU_APP_ID / FEISHU_APP_SECRET" });
      return;
    }

    // 飞书要求 3s 内响应，先回 200 再异步八卦
    res.status(200).json({ ok: true });

    void handleFeishuMessage(body, {
      appId,
      appSecret,
      offline: process.env.GOSSIP_OFFLINE === "1",
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
