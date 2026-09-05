import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Discord Interactions 在 Serverless 上需要「先 ACK 再 follow-up」，
 * 本 MVP 推荐用常驻进程：
 *
 *   DISCORD_BOT_TOKEN=xxx npm start
 *
 * 若只做 URL 校验（Portal 要求），本端点响应 PING。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      hint: "Discord 请用常驻进程：DISCORD_BOT_TOKEN=xxx npm start",
    });
    return;
  }

  const body = req.body as { type?: number };
  if (body?.type === 1) {
    res.status(200).json({ type: 1 });
    return;
  }

  res.status(200).json({
    type: 4,
    data: {
      content:
        "请使用常驻 Discord Bot（npm start）执行 /gossip。Serverless follow-up 将在后续版本完善。",
    },
  });
}
