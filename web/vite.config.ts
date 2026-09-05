import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const root = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(root, "../.env") });

function gossipApiPlugin(): Plugin {
  return {
    name: "gossip-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/gossip")) return next();

        try {
          const url = new URL(req.url, "http://localhost");
          let repo = url.searchParams.get("repo") ?? "";
          let offline = url.searchParams.get("offline") === "1";
          let days = Number(url.searchParams.get("days") ?? "14");

          if (req.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const body = JSON.parse(
              Buffer.concat(chunks).toString("utf8") || "{}",
            ) as {
              repo?: string;
              offline?: boolean;
              days?: number;
            };
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

          const { runGossip } = await server.ssrLoadModule(
            path.resolve(root, "../src/core/gossip.ts"),
          );

          const result = await runGossip({
            repo,
            offline,
            sinceDays: Number.isFinite(days) ? days : 14,
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              tabloid: result.tabloid,
              message: result.message,
              mode: result.mode,
              llmError: result.llmError,
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
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    alias: {
      "@gossip": path.resolve(root, "../src"),
    },
  },
});
