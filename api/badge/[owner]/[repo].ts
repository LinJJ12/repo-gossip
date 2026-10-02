import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  handleBadgeApiRequest,
  type HttpApiResponse,
} from "../../../packages/core/src/index.js";

/**
 * GET /api/badge/:owner/:repo.svg
 *
 * 业务逻辑在 core 的 handleBadgeApiRequest(缓存 / IP 限流 / 永不破图);
 * Vercel 把路径参数放进 req.query,本文件只做协议转换。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const response = await handleBadgeApiRequest({
    method: req.method ?? "GET",
    owner: req.query.owner,
    repo: req.query.repo,
    lang: req.query.lang,
    headers: req.headers as Record<string, string | string[] | undefined>,
  });
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value);
  }
  res.status(response.status).send(response.body);
}
