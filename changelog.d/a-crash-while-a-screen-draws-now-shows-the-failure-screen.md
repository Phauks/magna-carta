---
category: Added
audience: public
---

**A render boundary in the root layout** (`apps/web/src/lib/diagnostics/render-boundary.svelte`): a throw while a route's components render now draws the standard failure screen with a client-minted Error ID, the breadcrumb, and the Reload and Report controls, instead of a blank page and a line in the console. SvelteKit's `+error.svelte` answers a failure inside `load` only; a render throw escaped the app's start as an unhandled rejection, which is how the sign-in screen's tooltip crash was found in the inspector rather than on the page. The hook and the boundary share `crash.ts` (the handle, the breadcrumb, the one development console line, the remedy steps), so the two crash screens cannot drift. The web test config gains what mounting the failure screen needs: bits-ui and its Svelte helpers inlined, the build identity defined, and `$app/state` aliased to a stub.

## Public

**When a screen fails to draw, you now see the failure screen instead of a blank page.** It carries an Error ID you can quote, the details you can copy, and the Reload and Report a Problem controls, the same as every other failure in Magna Carta. Nothing is sent unless you choose to report it.
