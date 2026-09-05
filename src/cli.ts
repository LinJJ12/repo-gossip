#!/usr/bin/env node
import "dotenv/config";
import { runGossip } from "./core/gossip.js";

function printHelp() {
  console.log(`repo-gossip — 项目八卦小报

用法:
  npx tsx src/cli.ts <owner/repo|github-url> [options]

选项:
  --offline          不调用 LLM，使用本地土味翻译
  --days <n>         回溯天数（默认 14）
  --json             输出原始 JSON
  -h, --help         帮助

示例:
  npm run gossip -- vercel/next.js --offline
  npm run gossip -- https://github.com/openai/openai-node
`);
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const kv = new Map<string, string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--days") {
      kv.set("days", argv[++i] ?? "");
      continue;
    }
    if (a.startsWith("--")) {
      flags.add(a);
      continue;
    }
    positionals.push(a);
  }

  return { flags, kv, positionals };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const { flags, kv, positionals } = parseArgs(argv);
  const repo = positionals[0];
  if (!repo) {
    console.error("请提供仓库地址，例如 owner/repo");
    process.exit(1);
  }

  const sinceDays = Number(kv.get("days") ?? "14");
  const offline = flags.has("--offline");
  const json = flags.has("--json");

  console.error(`📡 正在偷看 ${repo} 的提交簿…`);

  const { tabloid, message } = await runGossip({
    repo,
    sinceDays: Number.isFinite(sinceDays) ? sinceDays : 14,
    offline,
  });

  if (json) {
    console.log(JSON.stringify(tabloid, null, 2));
  } else {
    console.log(message.markdown);
  }
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
