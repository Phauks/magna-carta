---
category: Added
audience: internal
---

Four new rules in `lint:one-ui`, so the consolidations cannot drift back one surface at a time.

A consolidation that is only a cleanup is a cleanup that gets undone: the next screen copies the nearest example, and the nearest example is whatever was written last. Each of these rules names one thing the platform has agreed to have once, and each was proved against a deliberately reintroduced violation before it landed.

- **`caps-register`** — the letterspaced small-caps voice built out of utilities, or finished by hand with an inline `letter-spacing`. The remedy is `FieldLabel`, or the `caps` option on the component being dressed.
- **`money-presentation`** — `style: "currency"` outside the two files allowed to print an amount. Date presentation is deliberately NOT gated and the runner says so: `Intl.DateTimeFormat` has twenty legitimate callers here doing time-zone arithmetic rather than display, and a rule that cried wolf over those is a rule somebody switches off.
- **`permission-refusal`** — the refusal sentence written out rather than taken from `permissionRefusal`. Both wordings are matched, and neither loosely: a dev-console note about somebody who "does not hold the address" is not a refusal, and the rule has a test saying so.
- **`details-panel`** — the panel's frame or scrolling body written out instead of composed from the shell.

Turning them on found four sites the hand migration had missed — an inline letter-spacing that had survived inside a converted component, two refusals written in full, and the false positive above, which is why the rule is now narrower than it started.

The last residuals went with them. The three `Card.Title`s in the invoice window that were field labels wearing a card title's name are `FieldLabel`s; the workbench's absence heading and the version chip's fleet label, both of which took their colour from `class:` directives and so slipped the first pass, are too. The app now writes the caps voice by hand nowhere and reaches for an inline `letter-spacing` nowhere.

One allowance is recorded rather than fixed: a Combobox group heading is a label, and the shared sentence is a sentence — ninety characters in a slot whose other branch reads "Add to the Firm's Practice Areas". It keeps the first clause of the shared wording verbatim so the two cannot disagree about the same permission.

`clockText` is gone. It was the last real second answer to "how long": a hand-derived `H:MM` beside the sheet, with a seconds mode the shared formatter lacked and no sign handling the shared one has. `formatClock(seconds, { toTheSecond })` is now the one clock, `formatDuration` reports it rather than deriving its own, and the equivalence was checked across 4001 quarter-minute probes before the old one was deleted. Its test moved to the formatter and gained the cases the sheet's copy never made.
