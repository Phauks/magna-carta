---
category: Fixed
audience: internal
---

`apps/web` had no client error boundary. A throw inside an event handler, an effect, or a promise
nobody awaited left a screen that silently stopped working, no Error ID, and nothing to report;
`+error.svelte` only ever caught a failure while loading or rendering a route. `hooks.client.ts` now
mints a handle for every one of them — prefixed `client_` rather than the platform's `error_`,
because it resolves to no server-side trace and a handle that looks like it should resolve costs
somebody a search — and installs the `onerror` and `unhandledrejection` handlers, which record the
exception's kind and where it was thrown and never its message.

Nothing files automatically. A crash offers Report a problem and does not send one, holding the
Off/strict default the diagnostics setting already defines.
