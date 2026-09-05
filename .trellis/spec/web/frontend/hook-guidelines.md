# Hook Guidelines — web

Current app uses only React built-ins:

- `useState` for form and result state
- No custom hooks, no `useEffect` for data loading (fetch is event-driven from submit/chips)

## When to add hooks

- Extract a hook only if a second component needs the same fetch/form logic.
- Prefer event handlers (`onSubmit`, chip `onClick`) over mounting effects for gossip generation.

## Anti-patterns

- Fetching on every keystroke without debounce/submit
- Adding `useMemo`/`useCallback` by default (not used in this app today)
