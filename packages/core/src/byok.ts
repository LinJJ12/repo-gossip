/** BYOK / webhook auth helpers — pure, header → env / auth decision. */

export type ByokEnvOverrides = {
  GITHUB_TOKEN?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
};

const BYOK_HEADERS = {
  "x-github-token": "GITHUB_TOKEN",
  "x-llm-api-key": "LLM_API_KEY",
  "x-llm-base-url": "LLM_BASE_URL",
  "x-llm-model": "LLM_MODEL",
} as const;

export type HeaderBag = Record<string, string | string[] | undefined>;

function singleHeader(
  headers: HeaderBag,
  name: string,
): string | undefined {
  const raw =
    headers[name] ??
    headers[name.toLowerCase()] ??
    headers[name.toUpperCase()];
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  return value;
}

/**
 * Read optional BYOK headers into `runGossip({ env })` overrides.
 * Missing / blank headers are omitted (server env remains).
 * Invalid `x-llm-base-url` is dropped (SSRF / scheme guard).
 *
 * LLM_BASE_URL / LLM_MODEL overrides are atomic: they only apply when the
 * caller also brings its own LLM_API_KEY. Otherwise the server's key would be
 * sent as `Authorization: Bearer …` to a caller-chosen base URL (key theft).
 */
export function extractByokEnv(
  headers: HeaderBag,
  options?: { allowPrivateLlmBaseUrl?: boolean },
): ByokEnvOverrides {
  const out: ByokEnvOverrides = {};
  const values = new Map<string, string>();
  for (const [header, envKey] of Object.entries(BYOK_HEADERS)) {
    const value = singleHeader(headers, header)?.trim();
    if (!value) continue;
    values.set(envKey, value);
  }
  const ghToken = values.get("GITHUB_TOKEN");
  if (ghToken) out.GITHUB_TOKEN = ghToken;
  const llmKey = values.get("LLM_API_KEY");
  if (llmKey) out.LLM_API_KEY = llmKey;
  if (llmKey) {
    const llmBaseUrl = values.get("LLM_BASE_URL");
    if (
      llmBaseUrl &&
      isAllowedLlmBaseUrl(llmBaseUrl, {
        allowPrivate: options?.allowPrivateLlmBaseUrl === true,
      })
    ) {
      out.LLM_BASE_URL = llmBaseUrl;
    }
    const llmModel = values.get("LLM_MODEL");
    if (llmModel) out.LLM_MODEL = llmModel;
  }
  return out;
}

function normalizeLlmHost(hostname: string): string {
  // WHATWG URL keeps brackets on IPv6 literals; trailing-dot FQDNs are the same host.
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.includes("%")) host = host.split("%")[0]!; // zone id
  return host;
}

/** Cloud metadata / link-local hosts are never allowed, even with an opt-in flag. */
function isMetadataHost(host: string): boolean {
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host === "100.100.100.100") return true; // Aliyun metadata
  return (
    host === "metadata.google.internal" ||
    host.endsWith(".metadata.google.internal") ||
    host === "metadata" ||
    host === "metadata.oraclecloud.com"
  );
}

function isPrivateIpv4Literal(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const octets = v4.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return true; // malformed literal — fail closed
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a === 169) return true; // 169 covers 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (incl. Aliyun metadata 100.100.100.100)
  return false;
}

/** Expand an IPv6 literal to 8 numeric segments; null when unparsable. */
function parseIpv6Segments(host: string): number[] | null {
  const parts = host.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 ? (parts[1] ? parts[1].split(":") : []) : [];
  if (parts.length < 2 && head.length !== 8) return null;
  if (parts.length === 2 && head.length + tail.length > 7) return null;
  const segs: number[] = [];
  for (const seg of [...head, ...Array(parts.length === 2 ? 8 - head.length - tail.length : 0).fill("0"), ...tail]) {
    if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
    segs.push(parseInt(seg, 16));
  }
  return segs.length === 8 ? segs : null;
}

/**
 * IPv6 判定。返回 "metadata"(永远封禁)/ "private"(allowPrivate 可放行)/
 * "public"。WHATWG 会把 [::ffff:169.254.169.254] 归一化成 ::ffff:a9fe:a9fe,
 * 所以映射 IPv4 必须按段展开后判定,点分正则抓不到。
 */
function classifyIpv6(host: string): "metadata" | "private" | "public" {
  const segs = parseIpv6Segments(host);
  if (!segs) return "metadata"; // unparsable — fail closed
  // IPv4-mapped ::ffff:0:0/96 → 用嵌入的 IPv4 走 v4 规则
  if (segs.slice(0, 5).every((s) => s === 0) && segs[5] === 0xffff) {
    const a = (segs[6]! >> 8) & 0xff;
    const b = segs[6]! & 0xff;
    const c = (segs[7]! >> 8) & 0xff;
    const d = segs[7]! & 0xff;
    const v4 = `${a}.${b}.${c}.${d}`;
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(v4)) return "metadata";
    return isPrivateIpv4Literal(v4) ? "private" : "public";
  }
  if (segs.every((s) => s === 0)) return "metadata"; // unspecified ::
  if (segs.slice(0, 7).every((s) => s === 0) && segs[7] === 1) return "private"; // ::1
  if ((segs[0]! & 0xfe00) === 0xfc00) return "metadata"; // fc00::/7 ULA(含 fd00:ec2::254)
  if ((segs[0]! & 0xffc0) === 0xfe80) return "metadata"; // fe80::/10 link-local
  return "public";
}

/**
 * Allow http(s) LLM endpoints; block cloud metadata / link-local / loopback /
 * private-range SSRF targets. Hostname-based (non-IP) targets pass — DNS
 * rebinding is out of scope for this synchronous check. Self-hosted local
 * gateways (ollama etc.) opt back in via GOSSIP_ALLOW_PRIVATE_LLM_BASE_URL=1.
 */
export function isAllowedLlmBaseUrl(
  raw: string,
  options?: { allowPrivate?: boolean },
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = normalizeLlmHost(url.hostname);
  if (host.includes(":")) {
    const kind = classifyIpv6(host);
    if (kind === "metadata") return false;
    if (kind === "private") return options?.allowPrivate === true;
    return true;
  }
  if (isMetadataHost(host)) return false;
  if (isPrivateIpv4Literal(host)) {
    return options?.allowPrivate === true;
  }
  return true;
}

/**
 * Credential from Authorization Bearer or x-webhook-secret.
 * `undefined` means neither header was sent.
 */
export function extractWebhookCredential(
  headers: HeaderBag,
): string | undefined {
  const auth = singleHeader(headers, "authorization");
  if (auth !== undefined) {
    return auth.replace(/^Bearer\s+/i, "");
  }
  const webhook = singleHeader(headers, "x-webhook-secret");
  if (webhook !== undefined) {
    return webhook;
  }
  return undefined;
}

/**
 * Constant-time-ish secret comparison (no node:crypto — this module is bundled
 * into the browser build too). Length-independent early-exit is avoided.
 */
export function secretEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type WebhookAuthDecisionInput = {
  secret: string | undefined;
  /** From extractWebhookCredential; undefined = no auth header sent */
  providedCredential: string | undefined;
  /** GOSSIP_REQUIRE_WEBHOOK_SECRET=1 */
  requireSecret: boolean;
  isProduction: boolean;
};

export type WebhookAuthDecision =
  | { ok: true; internal: boolean }
  | { ok: false; status: 401 | 500; error: string };

/**
 * Public-by-default gossip auth:
 * - Default: no webhook required; wrong secret when a secret is configured → 401.
 * - Kill-switch: production requires WEBHOOK_SECRET and a matching credential.
 */
export function decideWebhookAuth(
  input: WebhookAuthDecisionInput,
): WebhookAuthDecision {
  const secret = input.secret?.trim() || undefined;
  const provided = input.providedCredential;

  if (input.requireSecret) {
    if (!secret) {
      if (input.isProduction) {
        return {
          ok: false,
          status: 500,
          error: "WEBHOOK_SECRET is required in production",
        };
      }
      return { ok: true, internal: false };
    }
    if (provided === undefined || !secretEqual(provided, secret)) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
    return { ok: true, internal: true };
  }

  if (!secret) {
    return { ok: true, internal: false };
  }

  // Secret configured: public path if no credential header; mismatch → 401
  if (provided === undefined) {
    return { ok: true, internal: false };
  }
  if (!secretEqual(provided, secret)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true, internal: true };
}

/** Resolve Access-Control-Allow-Origin from GOSSIP_CORS_ORIGINS or `*`. */
export function resolveCorsAllowOrigin(
  requestOrigin: string | undefined,
  configuredOrigins: string | undefined,
): string {
  const configured = configuredOrigins?.trim();
  if (!configured || configured === "*") return "*";
  const list = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (requestOrigin && list.includes(requestOrigin)) {
    return requestOrigin;
  }
  return list[0] ?? "*";
}

export const GOSSIP_CORS_ALLOW_HEADERS = [
  "content-type",
  "authorization",
  "x-webhook-secret",
  "x-github-token",
  "x-llm-api-key",
  "x-llm-base-url",
  "x-llm-model",
].join(", ");

export const GOSSIP_CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
