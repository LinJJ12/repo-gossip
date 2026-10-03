import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  handleBadgeApiRequest,
  badgeErrorSvg,
  type HttpApiResponse,
} from "../../../packages/core/src/index.js";

/**
 * GET /api/badge/:owner/:repo.svg
 *
 * 业务逻辑在 core 的 handleBadgeApiRequest(缓存 / IP 限流 / 永不破图);
 * Vercel 把路径参数放进 req.query,本文件只做协议转换。
 * 适配层兜底也输出灰色 N/A 徽章,保证"永不破图"与 500 裸 HTML 页绝缘。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const response = await handleBadgeApiRequest({
      method: req.method ?? "GET",
      owner: req.query.owner,
      repo: req.query.repo,
      lang: req.query.lang,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });
    sendVercel(res, response);
  } catch (err) {
    console.error("[api/badge] adapter error:", err);
    sendVercel(res, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: badgeErrorSvg("zh"),
    });
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
