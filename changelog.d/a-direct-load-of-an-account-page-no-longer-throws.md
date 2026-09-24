---
category: Fixed
audience: internal
---

**A direct load of an account page no longer throws.** The Secure Shell captured Close's destination
with `navigation.from?.url.pathname`, and on a full page load SvelteKit's entry navigation carries a
`from` whose `url` is null — although `NavigationTarget.url` is typed as always a `URL`. Every direct
visit to `/account/*` logged a `TypeError` from `afterNavigate`. Close still went Home, because the
default was already right; the error was the only symptom. The decision now lives in
`apps/web/src/lib/components/secure-shell-return.ts`, which answers an `enter` navigation by its type
before reading `from`, and `apps/web/test/secure-shell-return.test.ts` pins it.
