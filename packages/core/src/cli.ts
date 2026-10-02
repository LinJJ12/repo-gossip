#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { runGossip, runScore, runCompare } from "./gossip.js";
import { missingSignalLabel } from "./score.js";
import type { ScoreLocale } from "./types.js";

loadDotenv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

function printHelp() {
  console.log(`repo-gossip

Usage:
  npm run gossip -- <owner/repo|github-url> [options]
  npm run gossip -- <owner/repo> <owner/repo2> [--compare]   2-4 个仓库对比

Options:
  --offline          skip LLM, use local templates
  --days <n>         lookback days (default 14)
  --score            含金量评分模式(输出评分卡,不调 LLM)
  --compare          含金量对比模式(2-4 个仓库,全部 positional 视为仓库)
  --lang <zh|en>     评分/对比输出语言(默认 zh)
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
    if (a === "--days" || a === "--lang") {
      kv.set(a.slice(2), argv[++i] ?? "");
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
  const score = flags.has("--score");
  const compare = flags.has("--compare");
  const langRaw = (kv.get("lang") ?? "").trim().toLowerCase();
  const locale: ScoreLocale = langRaw === "en" ? "en" : "zh";

  if (compare) {
    console.error(`Comparing ${positionals.join(" vs ")}...`);
    try {
      const { entries, message } = await runCompare({
        repos: positionals,
        locale,
      });
      if (json) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        console.log(message.markdown);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    return;
  }

  if (score) {
    console.error(`Scoring ${repo}...`);
    const { score: repoScore, message, missing } = await runScore({ repo, locale });
    if (missing.length > 0) {
      console.error(
        `[missing signals] ${missing.map((id) => missingSignalLabel(id)).join(", ")}`,
      );
    }
    if (json) {
      console.log(JSON.stringify(repoScore, null, 2));
    } else {
      console.log(message.markdown);
    }
    return;
  }

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
