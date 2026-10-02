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
const BADGE_PATH_RE = /^\/api\/badge\/([^/]+)\/([^/]+?)(?:\.svg)?$/;

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
        const isGossip = url.startsWith("/api/gossip");
        if (!isGossip && !(badgeMatch && req.method === "GET")) return next();

        let response: HttpApiResponse;
        if (isGossip) {
          let bodyText: string | undefined;
          if (req.method === "POST") {
            try {
              bodyText = await readBody(req);
            } catch {
              sendNode(res, {
                status: 413,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "body too large" }),
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
          reject(new Error("body too large"));
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
