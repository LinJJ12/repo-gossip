import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  handleGossipApiRequest,
  type HttpApiResponse,
} from "../packages/core/src/index.js";

/**
 * POST/GET /api/gossip
 *
 * 业务逻辑在 core 的 handleGossipApiRequest(路由 / 校验 / 鉴权 / 限流 / 缓存 /
 * 500 脱敏);本文件只做 Vercel 协议转换。
 * body: { "repo": "owner/repo", "offline"?: boolean, "days"?: number,
 *         "format"?: "markdown"|"json"|"discord"|"feishu"|"web",
 *         "mode"?: "score"|"compare", "repos"?: string[], "lang"?: "zh"|"en" }
 * BYOK: x-github-token / x-llm-api-key / x-llm-base-url / x-llm-model。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const response = await handleGossipApiRequest({
      method: req.method ?? "GET",
      url: req.url ?? "/api/gossip",
      headers: req.headers as Record<string, string | string[] | undefined>,
      bodyJson: req.body,
    });
    sendVercel(res, response);
  } catch (err) {
    // 协议层兜底(handler 内部已脱敏;这里只防意外抛出变成裸 500 页)。
    console.error("[api/gossip] adapter error:", err);
    res.status(500).json({ error: "internal error" });
  }
}

function sendVercel(res: VercelResponse, response: HttpApiResponse): void {
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value);
  }
  res.status(response.status);
  if (response.body === "") {
    res.end();
  } else {
    res.send(response.body);
  }
}
