# Tools listing page (design)

**Date:** 2026-07-08 · **Stream:** `slice-0-7b-app-shell` · **Status:** approved, building

## Purpose

Give the Tools area its first screen: a `/tools` page that lists every tool the firm
offers, grouped by subject, as tiles that read honestly against the maturity system.
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
2. **The domain catalog stays pure.** `packages/tools/CATALOG` owns tool *identity*
   (name, icon, subject group, permission, context tags, backing). No user-facing prose
   and no UI-lifecycle state is added to the domain package.
3. **Presentation lives app-side.** A new `apps/web/src/lib/tools/` module supplies the
   per-tool descriptor and maturity stage, plus the human labels for subject groups —
   the same shape `navigation/destinations.ts` uses for nav entries. A tool needs a row
   in the catalog *and* a presentation entry; a covering test asserts the two id-sets
   match, so a tool added to the catalog with no presentation entry fails CI rather than
   drifting silently. (Build-time completeness would require typing `CATALOG` `as const`
   to derive a literal `ToolId` union — a domain-package change held out of this slice.)
4. **Maturity system, not a bespoke chip.** Each tile carries a `MaturityStage`
   (`soon`/`alpha`/`beta`/`ready`) rendered with the existing `MaturityBadge`. A `ready`
   tool wears no badge and links to its page; anything below `ready` shows its stage
   badge and is inert. This is the same vocabulary the sidebar and matter nav already use.
5. **Honest first state.** No tool has a UI page yet, so every tile is `soon` today. As
   each tool's page is built in a later slice, its presentation entry advances and the
   tile becomes launchable. Nothing is faked — the Home-page principle.
6. **Permission-gated through the shared selector.** The page renders
   `toolsByGroup(CATALOG, permissions)` — the same gate the contextual surfaces use — so
   a member only sees tools their grants allow, groups render in the fixed
   `SUBJECT_GROUP_ORDER`, and empty groups are omitted. Permissions come from the shell's
   existing permission seam (today a mock granting the managing partner everything, the
   same posture as Settings).

## Route & files

Under `apps/web/`:

| File                                          | Role                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `src/routes/(app)/tools/+page.svelte`         | The listing page — masthead, grouped tile grid            |
| `src/lib/tools/tool-presentation.ts`          | id → `{ description, stage }` record; subject-group labels |
| `src/lib/tools/tool-presentation.test.ts`     | Completeness: every catalog id has a presentation entry   |

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
export const TOOL_PRESENTATION: Record<string, ToolPresentation> = { /* … */ };

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
```

Descriptors (all `stage: "soon"` at this slice):

| Tool                              | Descriptor                                                    |
| --------------------------------- | ------------------------------------------------------------- |
| Property Listing Links            | Open a property address across the major listing sites.       |
| County Property Records           | Jump to the county assessor and recorder for an address.      |
| Business Entity Lookup            | Find a company's registration in the state business registry. |
| Attorney License Lookup           | Check a lawyer's bar standing and discipline history.         |
| Shipping & Postage                | Rate and buy postage for a mailing.                           |
| Network Speed Test                | Measure this connection's speed to the platform.              |
| Firm Usage                        | See the firm's storage and platform consumption.              |
| WHOIS Lookup                      | Look up who registered a domain, and when.                    |
| Safe Website Viewer               | Open an untrusted website at arm's length.                    |
| File Converter                    | Convert a file from one format to another.                    |
| Metadata Inspector & Scrubber     | Inspect and strip hidden metadata from a file.                |
| File Hash & Integrity             | Compute a file's hash and confirm it hasn't changed.          |
| File Decryption & Recovery        | Unlock a protected file or recover its password.              |
| File Type Verifier                | Confirm what a file really is, whatever its extension says.    |
| AI-Text Detection                 | Estimate whether a passage was written by AI.                 |

## Layout & tile anatomy

Canvas voice throughout (standard tokens, no chrome register — theming stays at the edges).

- **Masthead.** "Tools" with the standing line *"Runs outside any matter."* — the ethereal
  principle stated at the page's ceremonial edge, in the Engraved Ledger register.
- **Sections.** One per non-empty subject group, in `SUBJECT_GROUP_ORDER`. Each opens with
  a small-caps engraved group label over a responsive tile grid.
- **Tile** (`card` + `MaturityBadge`):
  - Lucide icon (resolved from `manifest.icon`).
  - Title Case name (`manifest.name`).
  - One-line descriptor.
  - `MaturityBadge` for the stage — absent when `ready`.
  - `ready` → the whole tile is a link to `/tools/<id>`; below `ready` → inert, visibly
    quieter, with the badge carrying the "not yet" meaning (no separate disabled styling
    that reads as broken).

## Testing

- **Completeness** (`tool-presentation.test.ts`): every `CATALOG` id has exactly one
  `TOOL_PRESENTATION` entry and vice versa; every `SubjectGroup` has a label.
- **Render**: with the mock all-permissions principal, every catalog group with tools
  renders its section and the right tile count; a restricted principal omits gated tiles
  and any now-empty group.
- **Maturity**: a `ready` fixture tool renders no badge and a link; a `soon` tool renders
  the "Soon" badge and no link.

## Out of scope (named, not forgotten)

Drop zone / file staging · per-tool pages and run surfaces · recents/favorites/history
(a non-feature) · contextual surfacing from other pages (`toolsFor` already exists; no new
consumer here) · matter-action seam ("File to a Matter" belongs to each tool's page).
