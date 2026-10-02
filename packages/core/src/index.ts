export type {
  RepoRef,
  ScoreLocale,
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

export { runGossip, buildOfflineTabloid, runScore, runCompare } from "./gossip.js";
export type { GossipOptions, GossipMode, ScoreOptions, CompareOptions } from "./gossip.js";

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
  SCORE_DIMENSION_ORDER,
  SCORE_RUBRIC,
  missingSignalLabel,
  MISSING_SIGNAL_LABEL,
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
  starSeriesByDay,
  detectStarBursts,
  estimateWatermark,
  watermarkLevelLabel,
  WATERMARK_LEVEL_LABEL,
} from "./watermark.js";
export type {
  StarBurst,
  Watermark,
  WatermarkLevel,
} from "./watermark.js";

export {
  formatBadgeSvg,
  badgeErrorSvg,
  resolveBadgeRepoParam,
  badgeTextWidth,
  GRADE_COLORS,
} from "./badge.js";

export {
  formatCompareTable,
  formatCompareRadarSvg,
  parseCompareRepos,
  COMPARE_MIN,
  COMPARE_MAX,
} from "./compare.js";
export type { CompareEntry } from "./compare.js";

export {
  extractByokEnv,
  extractWebhookCredential,
  decideWebhookAuth,
  resolveCorsAllowOrigin,
  isAllowedLlmBaseUrl,
  secretEqual,
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

export {
  handleGossipApiRequest,
  handleBadgeApiRequest,
  gossipUsagePayload,
  clientIpFromHeaders,
  isProductionRuntime,
  type HttpApiRequest,
  type HttpApiResponse,
  type GossipApiDeps,
  type BadgeApiDeps,
  type BadgeApiInput,
} from "./http-api.js";

/** 宽松匹配文本中的 owner/repo(bot 平台解析聊天输入用;严格解析请用 parseRepoRef)。 */
export const LOOSE_REPO_PATTERN =
  /(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/;

/** 从任意文本中提取第一个 owner/repo;严格解析交给 parseRepoRef。 */
export function matchLooseRepo(text: string): string | null {
  const m = text.match(LOOSE_REPO_PATTERN);
  return m ? m[1]! : null;
}
