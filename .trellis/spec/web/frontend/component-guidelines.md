# Component Guidelines — web

## Composition

| Component | Role |
|-----------|------|
| `App` | Page shell: grain/glow atmosphere, hero brand, compose form, examples, loading/error, footer |
| `TabloidView` | Pure render of `TabloidPayload` sections (epic, temperature, awards, translations, eggs, authors, closing) |

Keep presentational markup in `TabloidView`; keep fetch/form state in `App`.

## Brand & layout (as implemented)

- Masthead + large `repo/gossip` brand before the tagline and form (`App.tsx` hero).
- Single column `min(720px)` centered; tabloid appears in `main.stage` below the hero.
- Atmosphere: fixed grain + drifting glow blobs in CSS — not card grids in the hero.

## Interaction pieces

- Primary CTA: coral 「出报」 button.
- Secondary chips for sample + example repos (interaction controls, not marketing card stacks).
- Filter empty translations before list render; show `（暂无翻译）` if drama missing.

## Anti-patterns

- Dashboard-style multi-widget first viewport
- Rebuilding tabloid sections inside `App` instead of `TabloidView`
- Introducing a component library for this small surface
