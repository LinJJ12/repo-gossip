import { Octokit } from "@octokit/rest";
import type {
  CommitStat,
  IssueStat,
  PullStat,
  ReleaseStat,
  RepoRef,
  RepoSnapshot,
} from "./types.js";
import { withGithubRetry } from "./github-retry.js";

const MAX_COMMITS = 40;
const MAX_PULLS = 15;
const MAX_ISSUES = 15;
const MAX_RELEASES = 5;

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
  const sinceMs = since.getTime();

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
  const [detailed, activity] = await Promise.all([
    mapPool(commitList.slice(0, maxCommits), 5, async (c) => {
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
    }),
    fetchActivity(octokit, ref, sinceMs),
  ]);

  return {
    ref,
    fullName: repo.full_name,
    description: repo.description,
    stars: repo.stargazers_count,
    language: repo.language,
    defaultBranch: repo.default_branch,
    commits: detailed,
    pulls: activity.pulls,
    issues: activity.issues,
    releases: activity.releases,
    fetchedAt: new Date().toISOString(),
    statsIncomplete: statsIncomplete || undefined,
    activityIncomplete: activity.activityIncomplete || undefined,
  };
}

async function fetchActivity(
  octokit: Octokit,
  ref: RepoRef,
  sinceMs: number,
): Promise<{
  pulls: PullStat[];
  issues: IssueStat[];
  releases: ReleaseStat[];
  activityIncomplete: boolean;
}> {
  let activityIncomplete = false;

  const [pulls, issues, releases] = await Promise.all([
    (async (): Promise<PullStat[]> => {
      try {
        const { data } = await withGithubRetry(() =>
          octokit.pulls.list({
            owner: ref.owner,
            repo: ref.repo,
            state: "all",
            sort: "updated",
            direction: "desc",
            per_page: MAX_PULLS,
          }),
        );
        return data
          .filter((p) => {
            const updated = p.updated_at ? Date.parse(p.updated_at) : NaN;
            const merged = p.merged_at ? Date.parse(p.merged_at) : NaN;
            return (
              (!Number.isNaN(updated) && updated >= sinceMs) ||
              (!Number.isNaN(merged) && merged >= sinceMs)
            );
          })
          .slice(0, MAX_PULLS)
          .map(
            (p): PullStat => ({
              number: p.number,
              title: oneLine(p.title ?? ""),
              author: p.user?.login ?? "anonymous",
              state: p.state ?? "open",
              merged: Boolean(p.merged_at),
              updatedAt:
                p.updated_at ?? p.created_at ?? new Date().toISOString(),
            }),
          );
      } catch {
        activityIncomplete = true;
        return [];
      }
    })(),
    (async (): Promise<IssueStat[]> => {
      try {
        const { data } = await withGithubRetry(() =>
          octokit.issues.listForRepo({
            owner: ref.owner,
            repo: ref.repo,
            state: "all",
            sort: "updated",
            direction: "desc",
            since: new Date(sinceMs).toISOString(),
            per_page: Math.min(MAX_ISSUES * 2, 100),
          }),
        );
        return data
          .filter((i) => !i.pull_request)
          .slice(0, MAX_ISSUES)
          .map(
            (i): IssueStat => ({
              number: i.number,
              title: oneLine(i.title ?? ""),
              author: i.user?.login ?? "anonymous",
              state: i.state ?? "open",
              labels: (i.labels ?? [])
                .map((l) => (typeof l === "string" ? l : l.name))
                .filter((n): n is string => Boolean(n))
                .map(oneLine),
              updatedAt:
                i.updated_at ?? i.created_at ?? new Date().toISOString(),
            }),
          );
      } catch {
        activityIncomplete = true;
        return [];
      }
    })(),
    (async (): Promise<ReleaseStat[]> => {
      try {
        const { data } = await withGithubRetry(() =>
          octokit.repos.listReleases({
            owner: ref.owner,
            repo: ref.repo,
            per_page: Math.min(MAX_RELEASES * 2, 20),
          }),
        );
        // Only releases inside the sinceDays window — out-of-window
        // fallbacks falsely trigger ship-it / “上线夜” on dormant repos.
        return data
          .map(
            (r): ReleaseStat => ({
              tag: oneLine(r.tag_name ?? ""),
              name: oneLine(r.name || r.tag_name || ""),
              author: r.author?.login ?? undefined,
              publishedAt:
                r.published_at ?? r.created_at ?? new Date().toISOString(),
              prerelease: Boolean(r.prerelease),
            }),
          )
          .filter((r) => r.tag && timeMs(r.publishedAt) >= sinceMs)
          .sort((a, b) => timeMs(b.publishedAt) - timeMs(a.publishedAt))
          .slice(0, MAX_RELEASES);
      } catch {
        activityIncomplete = true;
        return [];
      }
    })(),
  ]);

  return { pulls, issues, releases, activityIncomplete };
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

/** Collapse whitespace so titles don't break markdown / one-line layouts. */
function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim();
}

function timeMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
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
