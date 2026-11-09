# Tools listing page (design)

**Date:** 2026-07-08 · **Stream:** `slice-0-7b-app-shell` · **Status:** approved, building

## Purpose

Give the Tools area its first screen: a `/tools` page that lists every tool the firm
offers, grouped by subject, in either a tile grid or a dense list (owner's choice via a
toggle), each entry reading honestly against the maturity system.
This is the announced-but-unbuilt `tools` destination made real. It is a directory of
what the Tools area holds — not yet a workbench: there is no file drop, no per-tool page,
and no run surface in this slice. Those arrive tool-by-tool as each tool's own page is
built.

The Tools area is deliberately ethereal: matter-grade work done without committing to a
matter. The listing page states that plainly and never implies otherwise.

## Decisions

1. **Listing only.** The page lists tools and shows how finished each one is. No drop
   zone, no per-tool pages, no run stage, no recents/favorites/history. (History is a
   deliberate non-feature — privacy and the ethereal principle, not a deferral.)
2. **The domain catalog stays pure.** `packages/tools/CATALOG` owns tool _identity_
   (name, icon, subject group, permission, context tags, backing). No user-facing prose
   and no UI-lifecycle state is added to the domain package.
3. **Presentation lives app-side.** A new `apps/web/src/lib/tools/` module supplies the
   per-tool descriptor and maturity stage, plus the human labels for subject groups —
   the same shape `navigation/destinations.ts` uses for nav entries. A tool needs a row
   in the catalog _and_ a presentation entry; a covering test asserts the two id-sets
   match, so a tool added to the catalog with no presentation entry fails CI rather than
   drifting silently. (Build-time completeness would require typing `CATALOG` `as const`
   to derive a literal `ToolId` union — a domain-package change held out of this slice.)
4. **Maturity system, not a bespoke chip.** Each tile carries a `MaturityStage`
   (`soon`/`alpha`/`beta`/`ready`) rendered with the existing `MaturityBadge`. A `ready`
   tool wears no badge and links to its page; anything below `ready` shows its stage
   badge and is inert. This is the same vocabulary the sidebar and matter nav already use.
5. **Honest first state.** No tool has a UI page yet, so every entry is `soon` today. As
   each tool's page is built in a later slice, its presentation entry advances and the
   entry becomes launchable. Nothing is faked — the Home-page principle.
6. **Permission-gated through the shared selector.** The page renders
   `toolsByGroup(CATALOG, permissions)` — the same gate the contextual surfaces use — so
   a member only sees tools their grants allow, groups render in the fixed
   `SUBJECT_GROUP_ORDER`, and empty groups are omitted. Permissions come from the shell's
   existing permission seam (today a mock granting the managing partner everything, the
   same posture as Settings).
7. **Two views, one toggle.** The same grouped, permission-gated data renders in either a
   **tiles** view (the card grid) or a **list** view (dense rows), chosen by a segmented
   toggle in the masthead. This lets the owner compare the two treatments directly. The
   choice is a persisted per-member preference (default **tiles**), modelled on the
   existing sidebar preference store. The two views differ only in presentation — same
   grouping, same tile/row content, same launchable seam — so if the owner later settles
   on one, the other view and the toggle drop out with no data or logic change.

## Route & files

Under `apps/web/`:

| File                                            | Role                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/routes/(app)/tools/+page.svelte`           | The listing page — masthead, view toggle, grouped views                      |
| `src/lib/tools/tool-presentation.ts`            | id → `{ description, stage }`; group labels; icon map; `visibleToolGroups()` |
| `src/lib/tools/tools-view-preference.svelte.ts` | Persisted `"tiles" \| "list"` view preference (default tiles)                |
| `src/lib/tools/tool-tile.svelte`                | One tool as a card tile                                                      |
| `src/lib/tools/tool-row.svelte`                 | One tool as a dense list row                                                 |

Building this page flips `tools` from `shipped: false` to `shipped: true` (with a `stage`)
in `navigation/destinations.ts`. Ready-tool links target `/tools/<id>` — a defined seam;
no such route exists until a tool page is built.

## Presentation seam — `tool-presentation.ts`

```ts
export interface ToolPresentation {
  /** One line, plain language, what the tool does — no marketing voice. */
  readonly description: string;
  /** How finished the tool's UI surface is. `ready` → launchable, no badge. */
  readonly stage: MaturityStage;
}

// Keyed by ToolManifest.id (string). A covering test asserts the key set
// exactly matches the catalog ids — see tool-presentation.test.ts.
export const TOOL_PRESENTATION: Record<string, ToolPresentation> = {/* … */};

// SubjectGroup → engraved section label.
export const SUBJECT_GROUP_LABELS: Record<SubjectGroup, string> = {
  property: "Property",
  "business-entities": "Business Entities",
  "people-licenses": "People & Licenses",
  "mailing-shipping": "Mailing & Shipping",
  printing: "Printing",
  "web-domains": "Web & Domains",
  documents: "Documents & Files",
  diagnostics: "Diagnostics",
};

// Catalog icon-name string → imported Lucide component (explicit imports, no dynamic
// import). A covering test asserts every catalog icon appears here.
export const TOOL_ICONS: Record<string, Component> = { house: House /* … */ };

// The page's data: permitted tools grouped in fixed order. The mock permission set (the
// managing partner sees everything) is derived from the catalog; the real member grants
// replace it when auth lands, leaving this call site unchanged.
export function visibleToolGroups(): GroupedTools[] {
  /* toolsByGroup(CATALOG, mockPermissions) */
}
```

Descriptors (all `stage: "soon"` at this slice):

| Tool                          | Descriptor                                                    |
| ----------------------------- | ------------------------------------------------------------- |
| Property Listing Links        | Open a property address across the major listing sites.       |
| County Property Records       | Jump to the county assessor and recorder for an address.      |
| Business Entity Lookup        | Find a company's registration in the state business registry. |
| Attorney License Lookup       | Check a lawyer's bar standing and discipline history.         |
| Shipping & Postage            | Rate and buy postage for a mailing.                           |
| Network Speed Test            | Measure this connection's speed to the platform.              |
| Firm Usage                    | See the firm's storage and platform consumption.              |
| WHOIS Lookup                  | Look up who registered a domain, and when.                    |
| Safe Website Viewer           | Open an untrusted website at arm's length.                    |
| File Converter                | Convert a file from one format to another.                    |
| Metadata Inspector & Scrubber | Inspect and strip hidden metadata from a file.                |
| File Hash & Integrity         | Compute a file's hash and confirm it hasn't changed.          |
| File Decryption & Recovery    | Unlock a protected file or recover its password.              |
| File Type Verifier            | Confirm what a file really is, whatever its extension says.   |
| AI-Text Detection             | Estimate whether a passage was written by AI.                 |

## Layout & anatomy

Canvas voice throughout (standard tokens, no chrome register — theming stays at the edges).

- **Masthead.** "Tools" with the standing line _"Runs outside any matter."_ — the ethereal
  principle stated at the page's ceremonial edge, in the Engraved Ledger register. The
  **view toggle** sits in `Masthead.Actions`: a two-option segmented control (Tiles /
  List) built from design-system `Button`s with Lucide `layout-grid` / `list` icons,
  `aria-pressed` reflecting the active view, bound to the persisted preference.
- **Sections.** One per non-empty subject group, in `SUBJECT_GROUP_ORDER`, each opening
  with a small-caps engraved group label. The same sections render in both views; only the
  child layout changes — a responsive grid of `ToolTile` (tiles) or a hairline-separated
  stack of `ToolRow` (list).
- **Icon resolution.** `manifest.icon` is a Lucide name string; a `TOOL_ICONS` map in
  `tool-presentation.ts` resolves each catalog icon name to its imported component (the
  explicit-import idiom `destinations.ts` uses — no dynamic import). A covering test
  asserts every catalog icon has a map entry.
- **Tool tile** (`tool-tile.svelte` — `card` + `MaturityBadge`): icon, Title Case name,
  one-line descriptor, and the stage badge (absent when `ready`).
- **Tool row** (`tool-row.svelte`): a denser single line — leading icon, name, descriptor
  (muted, trailing off the name), stage badge at the row's end; hairline rule between rows.
- **Launchable seam (both shapes).** `ready` → the whole tile/row is a link to
  `/tools/<id>`; below `ready` → inert and visibly quieter, the badge carrying the "not
  yet" meaning (no disabled styling that reads as broken). Each component owns this branch
  so the page body stays declarative.

## Testing

Pure-logic tests under `apps/web/test/` (the established pattern — no component-render
harness exists in `apps/web`; the rendered page is checked in the browser).

- **Completeness** (`apps/web/test/tools-presentation.test.ts`): the `TOOL_PRESENTATION`
  key set exactly matches the `CATALOG` ids (no missing, no extra); every catalog
  `manifest.icon` has a `TOOL_ICONS` entry; every `SubjectGroup` has a `SUBJECT_GROUP_LABELS`
  entry.
- **Grouping** (`visibleToolGroups()`): with the mock all-permissions set, returns every
  catalog group that has tools, in `SUBJECT_GROUP_ORDER`, with the right tool counts; a
  restricted set omits gated tools and any now-empty group.
- **View preference**: defaults to `"tiles"`; setting to `"list"` persists and reloads.
- **Browser verification** (owner-facing, the point of this slice): both views render, the
  toggle switches between them and the choice survives a reload, every tile/row reads
  `soon`, and nothing is launchable yet.

## Out of scope (named, not forgotten)

Drop zone / file staging · per-tool pages and run surfaces · recents/favorites/history
(a non-feature) · contextual surfacing from other pages (`toolsFor` already exists; no new
consumer here) · matter-action seam ("File to a Matter" belongs to each tool's page).
