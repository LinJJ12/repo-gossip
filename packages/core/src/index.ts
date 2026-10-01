export type {
  RepoRef,
  Tabloid,
  AnalyzedGossip,
  PlatformMessage,
  CommitStat,
  PullStat,
  IssueStat,
  ReleaseStat,
  RepoSnapshot,
  Temperature,
  Award,
  EasterEgg,
} from "./types.js";

export { parseRepoRef, loadEnv, envSchema } from "./config.js";
export type { Env } from "./config.js";

export { runGossip, buildOfflineTabloid, runScore } from "./gossip.js";
export type { GossipOptions, GossipMode, ScoreOptions } from "./gossip.js";

export {
  computeRepoScore,
  formatScoreCard,
  logScale,
  ratioScale,
  forkStarScore,
  busFactorOf,
  momentumOf,
  gradeFor,
  confidenceFromMissing,
  SCORE_DIMENSION_WEIGHTS,
} from "./score.js";
export type {
  RepoScoreInput,
  RepoScore,
  ScoreDimension,
  ScoreDimensionId,
  ScoreGradeId,
  SanityCheck,
  SanityLevel,
} from "./score.js";

export { fetchRepoScoreInput } from "./github-score.js";
export type { RepoScoreFetchResult } from "./github-score.js";

export {
  extractByokEnv,
  extractWebhookCredential,
  decideWebhookAuth,
  resolveCorsAllowOrigin,
  isAllowedLlmBaseUrl,
  GOSSIP_CORS_ALLOW_HEADERS,
  GOSSIP_CORS_ALLOW_METHODS,
} from "./byok.js";
export type {
  ByokEnvOverrides,
  HeaderBag,
  WebhookAuthDecision,
  WebhookAuthDecisionInput,
} from "./byok.js";

export { analyzeSnapshot } from "./analyzer.js";
export { formatTabloid, toDiscordEmbed, toFeishuCard } from "./format.js";
export {
  createOctokit,
  fetchRepoSnapshot,
  messageScoreForDetail,
  pickCommitsForDetail,
  resolveDetailBudget,
  DEFAULT_MAX_COMMIT_DETAILS,
} from "./github.js";
export {
  withGithubRetry,
  isGithubRateLimitError,
  enrichGithubError,
} from "./github-retry.js";
export {
  generateTabloid,
  dramatizeLocally,
  normalizeTranslations,
  normalizeRawJson,
  safeParseTabloid,
  DEFAULT_LLM_TIMEOUT_MS,
} from "./llm.js";
export type {
  LlmConfig,
  ChatFetch,
  GenerateTabloidOptions,
  ParsedTabloid,
} from "./llm.js";

export {
  consumeRateLimit,
  resetRateLimitStores,
  parsePositiveInt,
  clampGossipDays,
} from "./rate-limit.js";
export type { RateLimitResult } from "./rate-limit.js";

export {
  buildGossipCacheKey,
  byokFingerprint,
  getGossipCache,
  setGossipCache,
  resetGossipCache,
} from "./gossip-cache.js";
export type { GossipCacheEntry } from "./gossip-cache.js";

export {
  isGithubLogin,
  isGithubFullName,
  githubUserUrl,
  githubRepoUrl,
  splitGithubLinkParts,
  linkifyGithubHtml,
  normalizeGithubLogins,
} from "./github-links.js";
export type { LinkifyPart, LinkifyOpts, LinkifyHtmlOpts } from "./github-links.js";
