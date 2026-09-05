import { z } from "zod";
import type { RepoRef } from "./types.js";

const GITHUB_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\.git)?\/?/i;
const SHORT = /^([^/\s]+)\/([^/\s#?]+)$/;

export function parseRepoRef(input: string): RepoRef {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(GITHUB_URL);
  if (fromUrl) {
    return {
      owner: fromUrl[1]!,
      repo: fromUrl[2]!.replace(/\.git$/i, ""),
    };
  }
  const short = trimmed.match(SHORT);
  if (short) {
    return { owner: short[1]!, repo: short[2]! };
  }
  throw new Error(
    `无法解析仓库地址：「${input}」。请使用 owner/repo 或 https://github.com/owner/repo`,
  );
}

export const envSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  LLM_API_KEY: z.string().min(1, "需要 LLM_API_KEY"),
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
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
