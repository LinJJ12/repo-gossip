import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "./types.js";
import type { RepoScoreInput } from "./score.js";
import { withGithubRetry } from "./github-retry.js";

/**
 * 含金量评分的数据抓取层:≤11 次 GitHub 调用/份,除 `repos.get`(硬依赖,
 * 失败即抛)外全部独立软失败 —— 单路失败只登记 missing 信号,不影响整体出分。
 * 降级语义遵循 error-handling.md( degrade,不整单失败)。
 */

const WINDOW_DAYS = 90;
const CONTRIBUTORS_PER_PAGE = 100;
/** star 时间线抓取门槛:低于此值的仓库没有刷量价值,省下 4 次调用。 */
const STAR_TIMELINE_MIN_STARS = 500;
/** 最多 4 页 × 100 个 stargazer(带 starred_at 时间戳)。 */
const STAR_TIMELINE_PAGES = 4;

/** stats 端点首次调用返回 202(GitHub 在后台算缓存),按递增间隔重试。 */
const STATS_RETRY_DELAYS_MS = [1_500, 2_500];

export type RepoScoreFetchResult = {
  input: RepoScoreInput;
  /** 与 input.missing 相同(去重后的缺失信号 id 列表)。 */
  missing: string[];
};

export async function fetchRepoScoreInput(
  octokit: Octokit,
  ref: RepoRef,
  options?: {
    /** 测试注入:202 重试前的等待毫秒数(生产默认 1200)。 */
    statsRetryDelayMs?: number;
  },
): Promise<RepoScoreFetchResult> {
  const missing = new Set<string>();

  const { data: repo } = await withGithubRetry(() =>
    octokit.repos.get({ owner: ref.owner, repo: ref.repo }),
  );

  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  async function soft<T>(signal: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await withGithubRetry(fn);
    } catch {
      missing.add(signal);
      return null;
    }
  }

  const [weeklyCommits, contributors, mergedPrs90d, closedIssues90d, openIssues, releases90d, hasReadme, hasCi, docs, starredAt] =
    await Promise.all([
      fetchWeeklyCommits(octokit, ref, missing, options?.statsRetryDelayMs),
      soft("contributors", async () => {
        const { data } = await octokit.repos.listContributors({
          owner: ref.owner,
          repo: ref.repo,
          per_page: CONTRIBUTORS_PER_PAGE,
        });
        // 204(空仓库)= 真实的"无贡献者",不是抓取失败。
        if (!Array.isArray(data)) return { list: [], truncated: false };
        return {
          list: data
            .filter((c) => (c.contributions ?? 0) > 0)
            .map((c) => ({
              login: c.login ?? c.name ?? "anonymous",
              contributions: c.contributions ?? 0,
            })),
          truncated: data.length >= CONTRIBUTORS_PER_PAGE,
        };
      }),
      soft("mergedPrs90d", async () => {
        const { data } = await octokit.search.issuesAndPullRequests({
          q: `repo:${repo.full_name} is:pr is:merged merged:>=${sinceIso}`,
          per_page: 1,
        });
        return data.total_count;
      }),
      soft("closedIssues90d", async () => {
        const { data } = await octokit.search.issuesAndPullRequests({
          q: `repo:${repo.full_name} is:issue is:closed closed:>=${sinceIso}`,
          per_page: 1,
        });
        return data.total_count;
      }),
      soft("openIssues", async () => {
        const { data } = await octokit.search.issuesAndPullRequests({
          q: `repo:${repo.full_name} is:issue is:open`,
          per_page: 1,
        });
        return data.total_count;
      }),
      soft("releases90d", async () => {
        const { data } = await octokit.repos.listReleases({
          owner: ref.owner,
          repo: ref.repo,
          per_page: 20,
        });
        const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
        return data.filter((r) => {
          const t = Date.parse(r.published_at ?? r.created_at ?? "");
          return Number.isFinite(t) && t >= cutoff;
        }).length;
      }),
      // README 用 getReadme:大小写/扩展名变体(readme.md、README.rst)都能命中。
      readmeProbe(octokit, ref, missing),
      // CI 以 .github/workflows 目录内容为准。
      (async (): Promise<boolean | null> => {
        try {
          const res = await octokit.repos.getContent({
            owner: ref.owner,
            repo: ref.repo,
            path: ".github/workflows",
          });
          return Array.isArray(res.data) && res.data.length > 0;
        } catch (err) {
          if (httpStatusOf(err) === 404) return false;
          missing.add("checklist");
          return null;
        }
      })(),
      // CONTRIBUTING / SECURITY 常见于根目录或 .github/ —— 各拉一份目录清单。
      probeDocs(octokit, ref, missing),
      // star 时间线:小仓库跳过(不算缺失),抓取失败才登记 stargazers。
      (repo.stargazers_count ?? 0) >= STAR_TIMELINE_MIN_STARS
        ? fetchStargazerTimeline(octokit, ref, missing)
        : Promise.resolve(null),
    ]);

  const hasContributing = docs?.hasContributing ?? null;
  const hasSecurity = docs?.hasSecurity ?? null;
  if (docs === null) missing.add("checklist");

  const contributorsSignal = contributors ?? null;
  const input: RepoScoreInput = {
    ref,
    fullName: repo.full_name,
    description: repo.description,
    language: repo.language,
    createdAt: repo.created_at ?? null,
    pushedAt: repo.pushed_at ?? null,
    archived: Boolean(repo.archived),
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    subscribers: repo.subscribers_count ?? null,
    openIssuesTotal: repo.open_issues_count ?? null,
    openIssues,
    licenseSpdx: repo.license?.spdx_id ?? null,
    weeklyCommits,
    contributors: contributorsSignal ? contributorsSignal.list : null,
    contributorsTruncated: contributorsSignal ? contributorsSignal.truncated : false,
    mergedPrs90d,
    closedIssues90d,
    releases90d,
    hasCi,
    hasReadme,
    hasContributing,
    hasSecurity,
    starredAt,
    starTimelineSkipped: (repo.stargazers_count ?? 0) < STAR_TIMELINE_MIN_STARS,
    missing: [...missing],
  };

  return { input, missing: input.missing };
}

/**
 * `/stats/commit_activity`:202 = GitHub 正在计算(按递增间隔重试);
 * 204 = 空仓库(合法零值);其它失败 → null 并登记 missing。
 * 成功返回 52 周总额(旧→新)。
 */
async function fetchWeeklyCommits(
  octokit: Octokit,
  ref: RepoRef,
  missing: Set<string>,
  retryDelayMs?: number,
): Promise<number[] | null> {
  const delays = retryDelayMs
    ? [retryDelayMs, retryDelayMs]
    : STATS_RETRY_DELAYS_MS;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await withGithubRetry(() =>
        octokit.repos.getCommitActivityStats({ owner: ref.owner, repo: ref.repo }),
      );
      // 204(空仓库)不在 Octokit 生成的 status 联合里,按实际数字比较。
      const status = res.status as number;
      if (status === 204) return [];
      if (status === 202) {
        if (attempt < delays.length) {
          await sleep(delays[attempt]!);
          continue;
        }
        missing.add("weeklyCommits");
        return null;
      }
      const rows = res.data;
      if (!Array.isArray(rows)) {
        missing.add("weeklyCommits");
        return null;
      }
      return rows.map((r) => (typeof r.total === "number" ? r.total : 0));
    } catch {
      missing.add("weeklyCommits");
      return null;
    }
  }
  missing.add("weeklyCommits");
  return null;
}

/** README 探测:getReadme 对大小写/扩展名变体宽容。 */
async function readmeProbe(
  octokit: Octokit,
  ref: RepoRef,
  missing: Set<string>,
): Promise<boolean | null> {
  try {
    await octokit.repos.getReadme({ owner: ref.owner, repo: ref.repo });
    return true;
  } catch (err) {
    if (httpStatusOf(err) === 404) return false;
    missing.add("checklist");
    return null;
  }
}

/**
 * CONTRIBUTING / SECURITY 在根目录或 `.github/` 都可能出现。
 * 两份目录清单并行拉取,大小写不敏感匹配;404 视为空清单。
 * 目录清单本身失败(非 404)→ 整组未知,登记 checklist。
 */
async function probeDocs(
  octokit: Octokit,
  ref: RepoRef,
  missing: Set<string>,
): Promise<{ hasContributing: boolean; hasSecurity: boolean } | null> {
  async function listDir(path: string): Promise<string[] | null> {
    try {
      const res = await octokit.repos.getContent({ owner: ref.owner, repo: ref.repo, path });
      if (!Array.isArray(res.data)) return [];
      return res.data
        .map((item) => (item.name ?? "").toLowerCase())
        .filter((n) => n !== "");
    } catch (err) {
      if (httpStatusOf(err) === 404) return [];
      return null;
    }
  }

  const [root, dotGithub] = await Promise.all([
    listDir("/"),
    listDir(".github"),
  ]);
  if (root === null || dotGithub === null) {
    missing.add("checklist");
    return null;
  }
  const names = [...root, ...dotGithub];
  return {
    hasContributing: names.some((n) => n.startsWith("contributing")),
    hasSecurity: names.some((n) => n.startsWith("security")),
  };
}

/**
 * stargazer 时间线(starred_at,`star+json` media type),最多 4 页。
 * 任一页失败 → 返回 null 并登记 stargazers(评分含水量标记覆盖不足)。
 *
 * ⚠️ 不要"改用" GraphQL 的 repository.stargazers 连接做回退:被 GitHub 风控
 * 标记的账号在 REST 得到 404,在 GraphQL 会得到 **静默空数据**(200 + totalCount:0
 * + 空 edges,实测 2026-10)。静默空时间线会让含水量误判为"干净",比缺失更糟。
 * 404 时正确动作就是登记 missing 并走比例信号降级。
 */
async function fetchStargazerTimeline(
  octokit: Octokit,
  ref: RepoRef,
  missing: Set<string>,
): Promise<string[] | null> {
  const starredAt: string[] = [];
  try {
    for (let page = 1; page <= STAR_TIMELINE_PAGES; page++) {
      const { data } = await withGithubRetry(() =>
        octokit.activity.listStargazersForRepo({
          owner: ref.owner,
          repo: ref.repo,
          per_page: 100,
          page,
          request: { mediaType: { format: "star+json" } },
        }),
      );
      if (!Array.isArray(data)) break;
      for (const item of data) {
        const t = (item as { starred_at?: string | null }).starred_at;
        if (typeof t === "string") starredAt.push(t);
      }
      if (data.length < 100) break;
    }
    return starredAt;
  } catch {
    missing.add("stargazers");
    return null;
  }
}

function httpStatusOf(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
