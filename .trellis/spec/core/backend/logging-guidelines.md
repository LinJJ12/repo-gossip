# Logging — core

## Conventions

- **CLI progress / mode hints** → `console.error` (keep stdout clean for markdown/JSON). Example: `Fetching gossip…`, `[mode=offline] …`
- **LLM failures** → `console.error("[llm]", llmError)` then return fallback tabloid
- No structured logger library in this package today — stick to `console.*`

## Do not

- Log API keys, tokens, or full LLM request bodies
- Print gossip markdown to stderr in success paths (stdout only unless `--json`)
