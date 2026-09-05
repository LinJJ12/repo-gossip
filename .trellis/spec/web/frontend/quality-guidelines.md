# Quality & Visual — web

## CSS system

`styles.css` defines tokens on `:root`:

- Colors: `--bg`, `--ink`, `--muted`, `--coral`, `--lime`, `--teal`, `--panel`, `--line`
- Fonts: Syne (display), Manrope (body), IBM Plex Mono (meta) — loaded from HTML, not Inter/Roboto defaults
- Motion: `rise`, `drift`, `pop`, `spin` — intentional, limited set

Temperature accents via classes `temp-blazing|warm|cool|frozen` setting `--accent`.

## UX copy

Chinese editorial tone (夜班编辑室、出报、主编正在写稿). Keep errors actionable.

## Accessibility

- `sr-only` label for repo input
- `aria-hidden` on decorative grain/glow
- `role="status"` on loading panel

## Verification

- `npm run web` — sample renders; live generate works with optional LLM
- `npm run typecheck -w @repo-gossip/web`
- `npm run web:build` before deploy

## Anti-patterns

- Flat single-color page with no atmosphere (grain/glow are part of the product look)
- Purple-on-white generic AI landing aesthetic that fights the existing coral/lime/teal system
- Shipping client code that prints `.env` values
