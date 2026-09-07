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
 */
export function extractByokEnv(headers: HeaderBag): ByokEnvOverrides {
  const out: ByokEnvOverrides = {};
  for (const [header, envKey] of Object.entries(BYOK_HEADERS)) {
    const value = singleHeader(headers, header)?.trim();
    if (!value) continue;
    if (envKey === "LLM_BASE_URL" && !isAllowedLlmBaseUrl(value)) {
      continue;
    }
    out[envKey as keyof ByokEnvOverrides] = value;
  }
  return out;
}

/**
 * Allow http(s) LLM endpoints; block cloud metadata / link-local SSRF targets.
 * Localhost is allowed for self-hosted gateways.
 */
export function isAllowedLlmBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host.endsWith(".metadata.google.internal")
  ) {
    return false;
  }
  // IPv4 link-local / metadata-ish
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return false;
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
    if (provided !== secret) {
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
  if (provided !== secret) {
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
