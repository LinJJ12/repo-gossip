/** Retry GitHub API calls on 403/429 with bounded backoff. */

export type GithubErrorLike = {
  status?: number;
  message?: string;
  response?: {
    headers?: HeadersLike;
  };
};

type HeadersLike =
  | Record<string, string | number | undefined>
  | { get?: (name: string) => string | null | undefined };

function headerValue(
  headers: HeadersLike | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === "function") {
    const v = (headers as { get: (n: string) => string | null | undefined }).get(
      name,
    );
    return v ?? undefined;
  }
  const rec = headers as Record<string, string | number | undefined>;
  const lower = name.toLowerCase();
  const raw = rec[name] ?? rec[lower] ?? rec[name.toUpperCase()];
  return raw == null ? undefined : String(raw);
}

export function isGithubRateLimitError(err: unknown): boolean {
  const e = err as GithubErrorLike;
  const status = e?.status;
  if (status !== 403 && status !== 429) return false;
  if (status === 429) return true;
  const msg = (e?.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("secondary rate") ||
    Boolean(headerValue(e.response?.headers, "retry-after")) ||
    headerValue(e.response?.headers, "x-ratelimit-remaining") === "0"
  );
}

export function retryAfterMsFromError(err: unknown, attempt: number): number {
  const e = err as GithubErrorLike;
  const retryAfter = headerValue(e.response?.headers, "retry-after");
  if (retryAfter) {
    const asNum = Number(retryAfter);
    if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  }
  return Math.min(8_000, 500 * 2 ** attempt);
}

export async function withGithubRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const sleep =
    options?.sleep ??
    ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isGithubRateLimitError(err) || attempt === maxAttempts - 1) {
        throw enrichGithubError(err);
      }
      await sleep(retryAfterMsFromError(err, attempt));
    }
  }
  throw enrichGithubError(lastErr);
}

export function enrichGithubError(err: unknown): Error {
  if (isGithubRateLimitError(err)) {
    const base = err instanceof Error ? err.message : String(err);
    return new Error(
      `GitHub API rate limited or forbidden. Set GITHUB_TOKEN / x-github-token and retry later. (${base})`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
