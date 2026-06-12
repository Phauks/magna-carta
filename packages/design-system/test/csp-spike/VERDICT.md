# CSP style-src spike — verdict

- **Captured:** 2026-06-12 (probe run green across all three engines; see "How to re-run" in [`README.md`](README.md))
- **Probed:** bits-ui `2.18.1`, svelte `5.56.2`, Playwright `1.60.0` — Chromium `148.0.7778.96`, Firefox `150.0.2`, WebKit `26.4`
- **Header:** `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'report-sample'` (static build; no `unsafe-eval`, no dev-server confounds)
- **Upstream issue:** [bits-ui #1995](https://github.com/huntabyte/bits-ui/issues/1995) — **open** as of 2026-06-12 (reported 2026-03-25; label "under review", huntabyte assigned, no maintainer response, no linked fix PR)

## The crux: which style-writing mechanism CSP actually blocks

`style-src` without `'unsafe-inline'` governs two channels (MDN, confirmed empirically):

| Mechanism                                                              | Strict `style-src 'self'`                                                                                                                              | Observed (all 3 engines)                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `<style>` elements                                                     | **Blocked** (`style-src-elem`)                                                                                                                         | not exercised (probe has none)                          |
| `style=""` attribute in markup / `setAttribute("style", ...)`          | **Blocked** (`style-src-attr`)                                                                                                                         | blocked + violation event, all engines                  |
| CSSOM property writes (`element.style.foo = ...`, `style.setProperty`) | **Allowed** (CSP does not hook CSSOM)                                                                                                                  | allowed, no violation                                   |
| `style.cssText = ...`                                                  | MDN's prose says blocked; **empirically allowed in every engine** (it is a CSSOM write — CSP hooks the attribute-change path, not CSSOM serialization) | 12 assignments per run, zero violations, styles applied |

Note `getAttribute("style")` returning a value proves nothing: CSSOM writes serialize back
into the attribute view. The probe therefore attributes every write to its API via prototype
instrumentation and treats `securitypolicyviolation` events plus computed styles as ground truth.

## Findings per component part

| Part                                                         | Mechanism observed                                                                                                                                             | Violation?                                  | Functions under strict CSP?                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Mount (all three components rendered, closed)                | none                                                                                                                                                           | none                                        | yes                                                                                                                   |
| Popover positioning (Floating UI via bits-ui floating layer) | Svelte `set_style` → `style.cssText` (5 writes per open)                                                                                                       | **none**                                    | **yes** — wrapper `position:absolute` + `transform: translate(...)` applied, content adjacent to trigger, all engines |
| Tooltip positioning                                          | same                                                                                                                                                           | **none**                                    | **yes**                                                                                                               |
| Dialog open: overlay/content style props                     | `style.cssText` (2 writes)                                                                                                                                     | none                                        | yes                                                                                                                   |
| Dialog open: scroll lock apply                               | direct CSSOM property writes (`body.style.overflow/pointerEvents/...`)                                                                                         | **none**                                    | **yes** — `overflow:hidden`, wheel does not scroll, all engines                                                       |
| Dialog open: focus trap                                      | n/a (no style writes)                                                                                                                                          | none                                        | yes — focus stays inside across repeated Tab                                                                          |
| **Dialog close: scroll lock restore**                        | **`document.body.setAttribute("style", initialBodyStyle ?? "")`** — `bits-ui/dist/internal/body-scroll-lock.svelte.js`, `resetBodyStyle()` (line 34 in 2.18.1) | **`style-src-attr` violation, all engines** | **no — engine-divergent breakage (below)**                                                                            |

The headline fear from issue #1995 — "Floating UI positions via inline styles, so every
floating component breaks" — is **unfounded** for the Svelte 5 runtime: the floating `style`
prop flows through Svelte's `set_style`, which writes via `style.cssText` (CSSOM), not the
attribute. Exactly **one** call in the entire Dialog/Popover/Tooltip surface violates strict
`style-src`: the scroll-lock _restore_ on dialog close.

### Aftermath of the blocked restore (engine-divergent)

| Engine       | After first dialog close                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium 148 | Attribute write rejected wholesale; the **old** declaration block survives → body stays `overflow:hidden` + `pointer-events:none` → **page permanently unscrollable and pointer-dead. Severe.** |
| WebKit 26.4  | Same as Chromium — **page permanently locked.**                                                                                                                                                 |
| Firefox 150  | Declaration block cleared, new value not applied → page recovers (scrolls again), **but pre-existing inline `<body>` styles are silently dropped** (probe marker lost).                         |

So under the platform's intended strict CSP, an unpatched bits-ui Dialog works until it is
closed once, then leaves the app dead in the two engines that together serve nearly all
users. This is a hard blocker for Tier 3 — mitigation required before Dialog/Sheet/Popover/
DropdownMenu ship (anything that takes a `BodyScrollLock`).

## Mitigation decision

**Chosen: (b) `pnpm patch bits-ui` — a one-line, behavior-preserving patch to the restore
path — plus (a) offering the same change upstream on #1995.**

The patch, in `internal/body-scroll-lock.svelte.js` `resetBodyStyle()`:

```js
// before (blocked by style-src-attr):
document.body.setAttribute("style", initialBodyStyle ?? "");
// after (CSSOM, CSP-clean):
document.body.style.cssText = initialBodyStyle ?? "";
```

Semantics are identical — both replace the whole inline declaration block and serialize back
into the attribute — but `cssText` is the same CSP-clean channel Svelte itself uses for every
`style` prop (`set_style`), proven by this probe in all three engines. If an engine ever
started blocking `cssText`, all of Svelte's style handling would break with it, so the patch
introduces no mechanism the stack does not already depend on.

**Apply the patch in the Tier 3 slice that first ships a scroll-locking component** (Dialog/
Sheet/DropdownMenu/Select); nothing in the package exercises `BodyScrollLock` before then.
Re-run this spike after applying to confirm zero violations end-to-end (the close-path
assertions will then need their expected-violation flipped — update this file in the same
commit).

Options rejected:

- **(c) `style-src-attr 'unsafe-inline'`** — narrower than full `unsafe-inline` (inline
  `<style>` elements stay blocked) and it would make the restore work. Honest risk delta: it
  re-opens attribute-based CSS injection wherever an attacker can influence an attribute —
  CSS is a real exfiltration channel (attribute-selector probing, `background-image`
  beacons), and this is a legal platform that renders privileged content. It also silences
  the violation signal that this spike uses to detect regressions. Not worth buying when the
  alternative is one patched line. Keep in reserve as the documented fallback if a future
  bits-ui release multiplies attribute-channel writes faster than patches are practical.
- **(d) `style-src 'unsafe-inline'`** — strictly weaker than (c) (also unblocks injected
  `<style>` elements). Rejected outright.

## Recheck conditions

1. **Upstream:** bits-ui #1995 closes or a release touches `body-scroll-lock` — re-run the
   spike; if the restore no longer violates, drop the patch and update this file plus the
   risk-register row.
2. **Every bits-ui or svelte upgrade:** re-run via `tools\run-csp-spike.cmd`. The driver
   asserts this verdict and exits non-zero on divergence (including the Svelte
   `set_style`/`cssText` mechanism this verdict leans on).
3. **Probe limitation to keep in mind:** headless runs had zero scrollbar width, so the
   scrollbar-compensation branch (`setProperty("--scrollbar-width", ...)` + padding/margin
   writes) did not execute — it is pure CSSOM by inspection, so it cannot change the verdict,
   but a headed re-run would exercise it.
