import { Octokit } from "@octokit/rest";
import type { CommitStat, RepoRef, RepoSnapshot } from "./types.js";
import { withGithubRetry } from "./github-retry.js";

const MAX_COMMITS = 40;

export function createOctokit(token?: string): Octokit {
  return new Octokit({
    auth: token || undefined,
    userAgent: "repo-gossip/0.1",
  });
}

export async function fetchRepoSnapshot(
  octokit: Octokit,
  ref: RepoRef,
  options?: { sinceDays?: number; maxCommits?: number },
): Promise<RepoSnapshot> {
  const sinceDays = options?.sinceDays ?? 14;
  const maxCommits = options?.maxCommits ?? MAX_COMMITS;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const { data: repo } = await withGithubRetry(() =>
    octokit.repos.get({
      owner: ref.owner,
      repo: ref.repo,
    }),
  );

  const { data: commitList } = await withGithubRetry(() =>
    octokit.repos.listCommits({
      owner: ref.owner,
      repo: ref.repo,
      since: since.toISOString(),
      per_page: Math.min(maxCommits, 100),
    }),
  );

  let statsIncomplete = false;
  const detailed = await mapPool(
    commitList.slice(0, maxCommits),
    5,
    async (c) => {
      try {
        const { data } = await withGithubRetry(() =>
          octokit.repos.getCommit({
            owner: ref.owner,
            repo: ref.repo,
            ref: c.sha,
          }),
        );
        return toCommitStat(data);
      } catch {
        statsIncomplete = true;
        return toCommitStat(c);
      }
    },
  );

  return {
    ref,
    fullName: repo.full_name,
    description: repo.description,
    stars: repo.stargazers_count,
    language: repo.language,
    defaultBranch: repo.default_branch,
    commits: detailed,
    fetchedAt: new Date().toISOString(),
    statsIncomplete: statsIncomplete || undefined,
  };
}

function toCommitStat(
  data: {
    sha: string;
    commit: {
      message: string;
      author: { name?: string | null; date?: string | null } | null;
      committer?: { date?: string | null } | null;
    };
    author?: { login?: string | null } | null;
    stats?: { additions?: number; deletions?: number } | null;
    files?: { filename?: string }[] | null;
  },
): CommitStat {
  return {
    sha: data.sha.slice(0, 7),
    message: (data.commit.message || "").split("\n")[0]!.trim(),
    author: data.author?.login || data.commit.author?.name || "anonymous",
    authorLogin: data.author?.login ?? undefined,
    date:
      data.commit.author?.date ||
      data.commit.committer?.date ||
      new Date().toISOString(),
    additions: data.stats?.additions ?? 0,
    deletions: data.stats?.deletions ?? 0,
    files: (data.files ?? [])
      .map((f) => f.filename)
      .filter((f): f is string => Boolean(f)),
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
