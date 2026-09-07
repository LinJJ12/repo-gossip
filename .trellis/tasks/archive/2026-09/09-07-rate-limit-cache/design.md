# Design — 限流与短时缓存

## Placement

Logic in `packages/core` pure helpers + thin `api/` wiring so tests do not need Vercel types.

- `packages/core/src/rate-limit.ts` — sliding/fixed window counter (memory Map)
- `packages/core/src/gossip-cache.ts` — TTL cache Map
- `api/gossip.ts` — call before/after `runGossip`

## Rate limit

- Keys: `ip:<ip>` and optionally counted per request (one consume per successful auth path).
- Also soft-limit by `repo:<owner/repo>` to reduce stampeding one repo.
- Env:
  - `GOSSIP_RATE_LIMIT_IP_PER_HOUR` (default `30`)
  - `GOSSIP_RATE_LIMIT_REPO_PER_HOUR` (default `60`)
- Internal calls (`decideWebhookAuth` internal: true) skip IP limit or use 10x — implement **skip IP limit for internal**, still allow cache.
- On exceed: HTTP 429 `{ error, retryAfterSec }` + `Retry-After` header.

## Cache

- Key: `sha1(repo|days|offline|byokFingerprint)` where fingerprint is `hasGithub|hasLlm|baseUrl|model` **without raw secrets**.
- TTL: `GOSSIP_CACHE_TTL_SEC` default `600`.
- Response header `X-Cache: HIT|MISS`.
- Memory only; document multi-instance caveat.

## IP extraction

`x-forwarded-for` first hop, else `x-real-ip`, else `req.socket` N/A on Vercel → `unknown`.
