#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { runGossip } from "./gossip.js";

loadDotenv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

function printHelp() {
  console.log(`repo-gossip

Usage:
  npm run gossip -- <owner/repo|github-url> [options]

Options:
  --offline          skip LLM, use local templates
  --days <n>         lookback days (default 14)
  --json             print raw JSON
  -h, --help         help
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
    console.error("Please provide owner/repo");
    process.exit(1);
  }

  const sinceDays = Number(kv.get("days") ?? "14");
  const offline = flags.has("--offline");
  const json = flags.has("--json");

  console.error(`Fetching gossip for ${repo}...`);

  const { tabloid, message, mode, llmError } = await runGossip({
    repo,
    sinceDays: Number.isFinite(sinceDays) ? sinceDays : 14,
    offline,
  });

  if (mode !== "llm") {
    console.error(`[mode=${mode}]${llmError ? ` ${llmError}` : ""}`);
  }

  if (json) {
    console.log(JSON.stringify(tabloid, null, 2));
  } else {
    console.log(message.markdown);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
