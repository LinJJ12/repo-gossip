/** Shared GitHub profile / repo link helpers for tabloid UIs. */

const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export function isGithubLogin(name: string): boolean {
  return LOGIN_RE.test(name);
}

/** `owner/repo` with safe path segments only. */
export function isGithubFullName(name: string): boolean {
  const parts = name.split("/");
  if (parts.length !== 2) return false;
  return parts.every(
    (p) =>
      p.length > 0 &&
      p.length <= 100 &&
      /^[A-Za-z0-9._-]+$/.test(p) &&
      !p.startsWith(".") &&
      !p.endsWith("."),
  );
}

export function githubUserUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`;
}

export function githubRepoUrl(fullName: string): string {
  const [owner, repo] = fullName.split("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Whole-token match for a GitHub login or fullName.
 * Avoids linking `sam` inside `samartomar`, or `a` inside every word.
 */
function tokenRegExp(token: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(token)})(?![A-Za-z0-9])`, "g");
}

export type LinkifyPart =
  | { type: "text"; value: string }
  | { type: "user"; value: string }
  | { type: "repo"; value: string };

export type LinkifyOpts = {
  fullName?: string;
  /** Candidate logins (will be filtered to valid GitHub logins). */
  logins?: string[];
  /**
   * Min length for prose auto-link (explicit UI fields can still link shorter logins).
   * Default 2 — blocks single-letter logins from matching every "a"/"I" in text.
   */
  minProseLoginLength?: number;
};

/**
 * Split plain text into text / user / repo segments for React (or other) rendering.
 * Repo fullName is claimed first so owner/repo parts are not nested as user links.
 */
export function splitGithubLinkParts(
  text: string,
  opts: LinkifyOpts = {},
): LinkifyPart[] {
  const source = String(text);
  if (!source) return [];

  type Slot = { kind: "repo" | "user"; value: string };
  const slots: Slot[] = [];
  const mark = (kind: "repo" | "user", value: string) => {
    const id = slots.length;
    slots.push({ kind, value });
    // Private-use markers survive typical text and won't appear in gossip copy.
    return `\uE000${id}\uE001`;
  };

  let work = source;
  const fullName =
    opts.fullName && isGithubFullName(opts.fullName) ? opts.fullName : undefined;
  if (fullName) {
    work = work.replace(tokenRegExp(fullName), (_m, pre: string) => {
      return `${pre}${mark("repo", fullName)}`;
    });
  }

  const minLen = opts.minProseLoginLength ?? 2;
  const logins = [...new Set(opts.logins ?? [])]
    .filter(isGithubLogin)
    .filter((l) => l.length >= minLen)
    .filter((l) => l !== fullName)
    .sort((a, b) => b.length - a.length);

  for (const login of logins) {
    work = work.replace(tokenRegExp(login), (_m, pre: string) => {
      return `${pre}${mark("user", login)}`;
    });
  }

  const parts: LinkifyPart[] = [];
  const re = /\uE000(\d+)\uE001/g;
  let last = 0;
  for (const m of work.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) {
      parts.push({ type: "text", value: work.slice(last, start) });
    }
    const slot = slots[Number(m[1])];
    if (slot) {
      parts.push({ type: slot.kind, value: slot.value });
    }
    last = start + m[0].length;
  }
  if (last < work.length) {
    parts.push({ type: "text", value: work.slice(last) });
  }
  return parts.length ? parts : [{ type: "text", value: source }];
}

export type LinkifyHtmlOpts = LinkifyOpts & {
  /** Anchor class name (default: gh-link). */
  className?: string;
};

/** Escape text then inject safe GitHub anchors (for extension / innerHTML UIs). */
export function linkifyGithubHtml(
  text: string,
  opts: LinkifyHtmlOpts = {},
): string {
  const className = opts.className || "gh-link";
  const parts = splitGithubLinkParts(text, opts);
  return parts
    .map((p) => {
      if (p.type === "text") return escapeHtml(p.value);
      if (p.type === "repo") {
        const href = githubRepoUrl(p.value);
        const label = escapeHtml(p.value);
        return `<a class="${className}" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      const href = githubUserUrl(p.value);
      const label = escapeHtml(p.value);
      return `<a class="${className}" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .join("");
}

/** Filter / sort logins for linkify (longest first). */
export function normalizeGithubLogins(candidates: Iterable<string>): string[] {
  return [...new Set([...candidates].map(String).filter(isGithubLogin))].sort(
    (a, b) => b.length - a.length,
  );
}
