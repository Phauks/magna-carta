# CSP style-src spike (bits-ui issue #1995)

A re-runnable probe answering: **do bits-ui's Dialog and floating parts (Floating UI
positioning) survive a strict `Content-Security-Policy: style-src 'self'` (no
`unsafe-inline`)?** Built as the week-1 risk task of the design-system plan, before any
Tier 3 (floating/portal) component, so Dialog/Sheet/Popover/DropdownMenu are not built on a
wrong assumption.

The empirical answer, the engine-by-engine findings, and the chosen mitigation live in
[`VERDICT.md`](VERDICT.md). The risk register row in
`docs/specs/2026-06-10-design-system-foundation-design.md` links here.

## How to run

```
tools\run-csp-spike.cmd                                      # from anywhere (repo launcher)
pnpm --filter @magna-carta/design-system run csp-spike       # equivalent package script
```

The script builds the probe app statically (`vite build`), serves `dist/` from a tiny
`node:http` server that adds the strict header

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'report-sample'
```

on every response, then drives headless Chromium — plus Firefox and WebKit when their
Playwright builds are installed (`pnpm exec playwright install firefox webkit`; Chromium is
already required by the Storybook tests) — through Dialog, Popover and Tooltip. A static
build is used instead of the Vite dev server on purpose: the dev server injects CSS through
`<style>` elements and needs `script-src 'unsafe-eval'`, both of which would confound the
probe; the static header is production-shaped.

The driver prints a findings JSON block per engine and then **asserts the documented
verdict**: a non-zero exit means observed behavior diverged from `VERDICT.md` (for example a
bits-ui release fixed #1995, or Svelte changed its style-writing mechanism) — re-evaluate and
update `VERDICT.md` plus the risk register. Re-run after every bits-ui or svelte upgrade.

## What it measures

- `securitypolicyviolation` events (collector registered before the app mounts).
- Per-mechanism style-write counts — `setAttribute("style", ...)` vs `style.cssText`
  assignment vs `style.setProperty(...)` — via prototype instrumentation in `main.ts`, so
  every violation (or its absence) is attributed to the exact API that produced it. This is
  the crux: CSP blocks the style _attribute_ channel, never CSSOM property writes, and
  `style.cssText` sits in between (see `VERDICT.md`).
- Functionality despite violations: dialog opens, focus trap holds, scroll-lock applies,
  page recovers (or not) after close, floating parts actually positioned at their triggers.

## Files

| File                       | Role                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `run-csp-spike.mjs`        | Driver: strict-header server + Playwright probe + verdict assertions     |
| `App.svelte`               | Probe page: unstyled Dialog, Popover, Tooltip (behavior probe only)      |
| `main.ts`                  | Mount + violation collector + style-write instrumentation                |
| `index.html` / `probe.css` | CSP-clean shell (external stylesheet, module script, no inline anything) |
| `vite.config.mjs`          | Static build config for the probe app only                               |
| `VERDICT.md`               | The captured verdict, mitigation decision and recheck conditions         |

## Deliberately not a vitest test

The probe needs its own HTTP server and response headers, three browser engines, and
~30 seconds of wall time; it must never run in `vp test` or CI. It is invoked only through
the `csp-spike` package script above. (Nothing here matches the package's vitest include
patterns — keep it that way.)
