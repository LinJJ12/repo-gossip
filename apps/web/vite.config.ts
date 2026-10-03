import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  handleGossipApiRequest,
  handleBadgeApiRequest,
  type HttpApiResponse,
} from "../../packages/core/src/http-api.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "../..");
loadDotenv({ path: path.resolve(repoRoot, ".env") });

const MAX_BODY_BYTES = 64_000;

class BodyTooLargeError extends Error {}
const BADGE_PATH_RE = /^\/api\/badge\/([^/]+)\/([^/]+?)(?:\.svg)?$/;
const GOSSIP_PATH_RE = /^\/api\/gossip(?:$|[/?])/;

/**
 * dev 中间件仅监听本机,但恶意网页可从浏览器直接打 localhost:5173(CORS 默认
 * 全开)。带 Origin 的跨站请求(除本扩展)一律 403,防止外部页面借 dev 服务器
 * 发 BYOK 覆写头;curl / 同源 fetch / 无 Origin 的请求不受影响。
 */
function isCrossSiteBrowserRequest(
  req: { headers: Record<string, string | string[] | undefined> },
  url: string,
): boolean {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin) return false;
  if (origin.startsWith("chrome-extension://")) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const hostHeader = req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  // 绝对 URL 形式的请求行(Vite 代理场景)从 url 里也取不到可信 host,以 Host 头为准。
  return originHost !== (host ?? new URL(url, "http://localhost").host);
}

/**
 * dev 环境的 /api/* 与生产(api/*.ts)共用 core 的 handleGossipApiRequest /
 * handleBadgeApiRequest —— 这里只做 Node req/res ↔ HttpApiResponse 的协议转换,
 * 路由 / 校验 / 鉴权 / 限流 / 缓存逻辑零拷贝。
 */
function gossipApiPlugin(): Plugin {
  return {
    name: "gossip-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "/";
        const badgeMatch = BADGE_PATH_RE.exec(url.split("?")[0] ?? "");
        const isGossip = GOSSIP_PATH_RE.test(url);
        if (!isGossip && !(badgeMatch && req.method === "GET")) return next();

        if (isCrossSiteBrowserRequest(req, url)) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "cross-site request rejected" }));
          return;
        }

        let response: HttpApiResponse;
        if (isGossip) {
          let bodyText: string | undefined;
          if (req.method === "POST") {
            try {
              bodyText = await readBody(req);
            } catch (err) {
              // 超限 → 413;断连/流错误 → 400,不混淆。
              const tooLarge = err instanceof BodyTooLargeError;
              sendNode(res, {
                status: tooLarge ? 413 : 400,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  error: tooLarge ? "body too large" : "invalid body",
                }),
              });
              return;
            }
          }
          response = await handleGossipApiRequest({
            method: req.method ?? "GET",
            url,
            headers: req.headers,
            bodyText,
          });
        } else {
          const [, owner, repo] = badgeMatch!;
          const lang = new URL(url, "http://localhost").searchParams.get("lang");
          response = await handleBadgeApiRequest({
            method: "GET",
            owner,
            repo,
            lang,
            headers: req.headers,
          });
        }
        sendNode(res, response);
      });
    },
  };
}

function readBody(req: {
  [Symbol.asyncIterator](): AsyncIterableIterator<unknown>;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    void (async () => {
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as BufferSource);
        size += buf.length;
        if (size > MAX_BODY_BYTES) {
          reject(new BodyTooLargeError("body too large"));
          return;
        }
        chunks.push(buf);
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    })().catch(reject);
  });
}

function sendNode(
  res: import("node:http").ServerResponse,
  response: HttpApiResponse,
): void {
  res.statusCode = response.status;
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value);
  }
  res.end(response.body);
}

export default defineConfig({
  root: path.resolve(root),
  plugins: [react(), gossipApiPlugin()],
  resolve: {
    alias: {
      "@repo-gossip/core/github-links": path.resolve(
        repoRoot,
        "packages/core/src/github-links.ts",
      ),
      "@repo-gossip/core": path.resolve(repoRoot, "packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    open: process.env.E2E !== "1",
    fs: {
      allow: [repoRoot],
    },
  },
});
