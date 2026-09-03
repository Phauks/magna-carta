---
category: Added
audience: public
---

**A screen entered from another screen now carries a way back to it, and a gate says so before review does.** Three of the application's detail screens shipped without one — the directory record and both conflicts detail screens — and the one screen that had it, the matter header, had grown its own copy of the affordance out of `EyebrowLink` and an arrow icon rather than composing the shared component. Neither is a visible defect: the screen looks finished, the sidebar still works, and nothing in the diff says the way out was never built.

`apps/web/src/lib/navigation/back-link.svelte` now carries both forms rather than one. **Labelled** is the default and unchanged: a `nav` row above the masthead, the arrow followed by the destination's name rather than the word "Back". **Arrow-only** is the matter header's shape, promoted out of it: where the header's top line already reads in the eyebrow register, the arrow leads that line instead of stacking a second caps label above it, which competed for the same register and read as a breadcrumb trail with one crumb (owner ruling, 2026-09-01). The accessible name is "Back to \<destination\>" either way, so the destination is spoken even where it is not shown, and the matter header's rendered markup is byte-identical to what it hand-rolled.

The directory record's arrow leads its kind line; both conflicts detail screens turn the eyebrow that already named the register into the link that returns to it, so the way back costs no line it was not already spending; the four developer-console galleries do the same with the caps line that named the console.

`pnpm run lint:back-navigation` is what makes the next one mechanical rather than remembered. The rule is derived from the route tree, never a list: a route whose nearest ancestor route renders a page of its own must offer a way back to it — in the page, or in a layout between them, through however many components its header is built from — and the link must lead **there**, not merely somewhere, which is checked by resolving the `href` (a literal, or a `const NAME = "…"` beside the markup) against the ancestor's own path. A route whose ancestors only redirect or only draw a shell is asked for nothing, which is why `/settings/theme` is not in scope and needs no exemption to stay out. The gate also refuses the drift it was written after: a header hand-rolling the affordance instead of composing `BackLink`. It runs in the inner loop and in CI by derivation — every `lint:*` script in the root manifest is repo-wide — so no workflow edit was needed, and `tooling/lint-back-navigation/back-navigation.test.mjs` feeds it deliberately broken route trees so the assertions are known to bite.

## Public

**Every screen you open from another screen now has an arrow taking you back to it.**

Opening a person from the Directory, or a conflicts check from the register, used to leave you with the browser's back button and the sidebar. That is fine until the screen arrived some other way — from a link a colleague sent, from a search result, in a fresh tab — where there is no history to step back through and the sidebar takes you to the top of a section rather than to the list you were reading.

The arrow sits at the top left of the screen's own header, and it names where it goes: back to the Directory, back to the conflicts register, back to the docket. Matters and the firm's tools already worked this way; the rest of the application now does too, and a new screen cannot ship without it.
