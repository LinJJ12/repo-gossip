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
          let mode = url.searchParams.get("mode") ?? undefined;

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
              mode?: string;
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
            if (typeof body.mode === "string") mode = body.mode;
          }

          if (!repo) {
            // 与 api/gossip.ts 对齐:GET 无 repo = 健康检查(200 usage),POST 缺参 = 400。
            res.statusCode = req.method === "GET" ? 200 : 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify(
                req.method === "GET"
                  ? {
                      ok: true,
                      usage:
                        'GET /api/gossip?repo=owner/repo or POST {"repo":"owner/repo","format":"web"}',
                    }
                  : { error: "请提供 repo" },
              ),
            );
            return;
          }

          // 与 api/gossip.ts 对齐:非法 repo 表达式 → 400(而非管线抛错后的 500)。
          try {
            (await server.ssrLoadModule(
              path.resolve(repoRoot, "packages/core/src/config.ts"),
            )).parseRepoRef(repo);
          } catch (err) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            return;
          }

          const [{ runGossip, runScore }, { extractByokEnv, clampGossipDays }] =
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

          if ((mode ?? "").trim().toLowerCase() === "score") {
            const { score, message, missing } = await runScore({ repo, env });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ kind: "score", score, message, missing }));
            return;
          }

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

function badgeApiPlugin(): Plugin {
  return {
    name: "badge-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // GET /api/badge/:owner/:repo.svg
        const match = /^\/api\/badge\/([^/]+)\/([^/]+?)(?:\.svg)?$/.exec(
          req.url?.split("?")[0] ?? "",
        );
        if (!match || req.method !== "GET") return next();

        const [, owner, repo] = match;
        try {
          const [
            { runScore },
            { formatBadgeSvg, badgeErrorSvg, resolveBadgeRepoParam },
          ] = await Promise.all([
            server.ssrLoadModule(
              path.resolve(repoRoot, "packages/core/src/gossip.ts"),
            ),
            server.ssrLoadModule(
              path.resolve(repoRoot, "packages/core/src/badge.ts"),
            ),
          ]);

          const repoRef = resolveBadgeRepoParam(owner, repo);
          if (!repoRef) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "invalid badge repo path" }));
            return;
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
          try {
            const { score } = await runScore({ repo: repoRef });
            res.end(formatBadgeSvg(score));
          } catch {
            res.end(badgeErrorSvg());
          }
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
  plugins: [react(), gossipApiPlugin(), badgeApiPlugin()],
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
    open: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
