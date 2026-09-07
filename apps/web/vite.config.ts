import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "../..");
loadDotenv({ path: path.resolve(repoRoot, ".env") });

function gossipApiPlugin(): Plugin {
  return {
    name: "gossip-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/gossip")) return next();

        if (req.method === "OPTIONS") {
          const { resolveCorsAllowOrigin, GOSSIP_CORS_ALLOW_HEADERS, GOSSIP_CORS_ALLOW_METHODS } =
            await server.ssrLoadModule(
              path.resolve(repoRoot, "packages/core/src/byok.ts"),
            );
          const origin = Array.isArray(req.headers.origin)
            ? req.headers.origin[0]
            : req.headers.origin;
          res.statusCode = 204;
          res.setHeader(
            "Access-Control-Allow-Origin",
            resolveCorsAllowOrigin(origin, process.env.GOSSIP_CORS_ORIGINS),
          );
          res.setHeader("Access-Control-Allow-Methods", GOSSIP_CORS_ALLOW_METHODS);
          res.setHeader("Access-Control-Allow-Headers", GOSSIP_CORS_ALLOW_HEADERS);
          res.end();
          return;
        }

        if (req.method !== "GET" && req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const url = new URL(req.url, "http://localhost");
          let repo = url.searchParams.get("repo") ?? "";
          let offline = url.searchParams.get("offline") === "1";
          let days = Number(url.searchParams.get("days") ?? "14");

          if (req.method === "POST") {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              size += buf.length;
              if (size > 64_000) {
                res.statusCode = 413;
                res.end(JSON.stringify({ error: "body too large" }));
                return;
              }
              chunks.push(buf);
            }
            let body: {
              repo?: string;
              offline?: boolean;
              days?: number;
            } = {};
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "invalid JSON" }));
              return;
            }
            repo = body.repo ?? repo;
            if (typeof body.offline === "boolean") offline = body.offline;
            if (typeof body.days === "number") days = body.days;
          }

          if (!repo) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "请提供 repo" }));
            return;
          }

          const [{ runGossip }, { extractByokEnv, clampGossipDays }] =
            await Promise.all([
              server.ssrLoadModule(
                path.resolve(repoRoot, "packages/core/src/gossip.ts"),
              ),
              server.ssrLoadModule(
                path.resolve(repoRoot, "packages/core/src/index.ts"),
              ),
            ]);

          const env = extractByokEnv(
            req.headers as Record<string, string | string[] | undefined>,
          );

          const result = await runGossip({
            repo,
            offline,
            sinceDays: clampGossipDays(
              Number.isFinite(days) ? days : 14,
            ),
            env,
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              tabloid: result.tabloid,
              message: result.message,
              mode: result.mode,
              llmError: result.llmError,
              warnings: result.warnings,
            }),
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  root: path.resolve(root),
  plugins: [react(), gossipApiPlugin()],
  resolve: {
    alias: {
      "@repo-gossip/core": path.resolve(repoRoot, "packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    open: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
