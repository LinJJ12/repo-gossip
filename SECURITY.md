# Security Policy

## Supported versions

This project is provided as-is under the MIT license. Security fixes are applied on a best-effort basis on the default branch.

## Reporting a vulnerability

Please **do not** open a public GitHub Issue for sensitive reports.

Prefer one of:

1. GitHub **Private vulnerability reporting** on this repository (if enabled), or
2. Contact the maintainer via the profile linked from the repository owner.

Include: affected component (Web / API / extension / bot), impact, and steps to reproduce when possible.

## What must never be committed

| Item | Why |
|------|-----|
| `.env` (real values) | Tokens and bot secrets |
| `*.pem` / extension signing keys | Can forge / resign the Chrome extension |
| `*.crx` built with your private key | Packaging artifact; key material risk if paired with `.pem` |
| BYOK keys in source | Live in `chrome.storage.local` or request headers only |

Use [`.env.example`](.env.example) as the template. Copy to `.env` locally.

## Extension packaging

If you run Chrome’s “打包扩展程序”:

- Keep the generated `.pem` **only on your machine**
- Do not publish or commit the `.pem`
- Prefer sideload of the `apps/extension` folder for open-source contribution

## API notes

- Public `POST /api/gossip` may run without `WEBHOOK_SECRET` by default
- For production lock-down, set `GOSSIP_REQUIRE_WEBHOOK_SECRET=1` and configure secrets in the host (Vercel / Railway), not in git
- BYOK headers must never be logged or echoed in responses
