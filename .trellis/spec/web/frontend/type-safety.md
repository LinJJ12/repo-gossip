# Type Safety — web

## Frontend mirror types

`apps/web/src/types.ts` defines `TabloidPayload`, `GossipMode`, `TemperatureLevel` for JSON from the API. This is intentionally a **structural mirror** of core tabloid fields, not a direct import of all core types (keeps the client payload explicit).

When changing core `Tabloid` / mode unions, update:

1. `packages/core/src/types.ts` / `gossip.ts`
2. `apps/web/src/types.ts`
3. `MODE_LABEL` / `TEMP_CLASS` maps in `App.tsx` / `TabloidView.tsx`
4. `sample.ts` if the sample shape breaks

## Typing habits

- `FormEvent` for submit handlers
- Narrow API errors with `as TabloidPayload & { error?: string }` then check `res.ok`
- Temperature CSS via `Record<TemperatureLevel, string>` — exhaustive keys

## Anti-patterns

- Using `any` for gossip responses
- Letting web types drift so `TabloidView` assumes fields the API no longer sends
