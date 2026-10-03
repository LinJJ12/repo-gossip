import { z } from "zod";
import type { RepoRef } from "./types.js";
import { isGithubFullName } from "./github-links.js";

const GITHUB_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\.git)?\/?/i;
const SHORT = /^([^/\s]+)\/([^/\s#?]+)$/;

/**
 * Parse `owner/repo` or a GitHub URL into a RepoRef.
 * Segments must pass isGithubFullName (alphanumerics / . _ -, no leading or
 * trailing dot) so invalid input becomes a clean 400 here instead of an
 * opaque upstream 404/500 later.
 */
export function parseRepoRef(input: string): RepoRef {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(GITHUB_URL);
  const fromShort = fromUrl ? null : trimmed.match(SHORT);
  const owner = fromUrl?.[1] ?? fromShort?.[1];
  const repo = (fromUrl?.[2] ?? fromShort?.[2])?.replace(/\.git$/i, "");
  if (owner && repo && isGithubFullName(`${owner}/${repo}`)) {
    return { owner, repo };
  }
  throw new Error(
    `Cannot parse repo: "${input}". Use owner/repo or https://github.com/owner/repo`,
  );
}

/** 数值环境变量:非法值回落默认而不是让 zod 在请求路径上抛 500。 */
function numericEnv(fallback: number, min = 1) {
  return z.preprocess(
    (v) => {
      if (v == null || (typeof v === "string" && v.trim() === "")) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    },
    z.number().int().min(min).catch(fallback),
  );
}

export const envSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  /** Per-request LLM timeout. Optional; defaults to 20s. */
  LLM_TIMEOUT_MS: numericEnv(20_000),
  /** Max commits to pull per-detail stats for (the rest keep list-level info only). Optional; defaults to 20. */
  GOSSIP_MAX_COMMIT_DETAILS: numericEnv(20, 0),
  DISCORD_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  FEISHU_VERIFICATION_TOKEN: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(partial?: Record<string, string | undefined>): Env {
  const raw = {
    GITHUB_TOKEN: partial?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN,
    LLM_API_KEY: partial?.LLM_API_KEY ?? process.env.LLM_API_KEY,
    LLM_BASE_URL: partial?.LLM_BASE_URL ?? process.env.LLM_BASE_URL,
    LLM_MODEL: partial?.LLM_MODEL ?? process.env.LLM_MODEL,
    LLM_TIMEOUT_MS: partial?.LLM_TIMEOUT_MS ?? process.env.LLM_TIMEOUT_MS,
    GOSSIP_MAX_COMMIT_DETAILS:
      partial?.GOSSIP_MAX_COMMIT_DETAILS ??
      process.env.GOSSIP_MAX_COMMIT_DETAILS,
    DISCORD_BOT_TOKEN:
      partial?.DISCORD_BOT_TOKEN ?? process.env.DISCORD_BOT_TOKEN,
    TELEGRAM_BOT_TOKEN:
      partial?.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN,
    FEISHU_APP_ID: partial?.FEISHU_APP_ID ?? process.env.FEISHU_APP_ID,
    FEISHU_APP_SECRET:
      partial?.FEISHU_APP_SECRET ?? process.env.FEISHU_APP_SECRET,
    FEISHU_VERIFICATION_TOKEN:
      partial?.FEISHU_VERIFICATION_TOKEN ??
      process.env.FEISHU_VERIFICATION_TOKEN,
    WEBHOOK_SECRET: partial?.WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET,
  };
  return envSchema.parse(raw);
}
