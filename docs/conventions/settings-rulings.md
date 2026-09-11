# Settings — the owner's standing rulings

Every ruling the owner has issued on the Settings surface, cumulative, newest round last. **A ruling
here is settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round
that silently reverts one is a regression, not a redesign.

The surface is `apps/web/src/routes/(app)/settings/` and the parts it is built from in
`apps/web/src/lib/settings/`. Read this file before changing any of it, and check the built screens
against it after. Do not rebuild a page from scratch: edit it.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

Rulings that generalize from the other surfaces' ledgers bind here too — notably
[`file-manager-rulings.md`](file-manager-rulings.md) (Lucide-only icons, no inert controls, say what
a control will do, no reflow under the hand) and the standing corrections in
[`design-corrections.md`](design-corrections.md), which already settle that **every closed choice is
a combobox rather than a select** and that **a control that comes and goes never ends a row**.

## R1 — round one: the settings surface wants consolidating

The owner's notes of 2026-09-11, staged. **Nothing here has been started** — the round was recorded
ahead of the work and waits on the owner's go-ahead, so every row below is `open` as a statement of
fact rather than an oversight. The research beneath each group is what the code says today; it is
not a plan, and where it names a remedy that is a starting point for the round, not a decision
already taken.

### The surface itself — consolidation

| #  | Ruling                                                                                                                                                                                                                                                                                        | Status |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| G1 | **Every settings page is built from one page shape.** One scroll region, one plate rhythm, one row grid, one set of spacings — so changing how a settings page looks is one edit rather than twenty-three. A page with a bespoke need composes the same parts; it does not re-implement them. | open   |
| G2 | **A choice is shown the same way wherever it appears in settings.** The page does not get to pick between a radio group, a select and a switch on its own — the setting's declaration says what it is and the shape follows from that.                                                        | open   |
| G3 | **A settings table is the product's table, with everything the product's tables do** — sort, filter, the column roster, resizing, the counts strip. A register in Settings is not a lesser table than a register anywhere else.                                                               | open   |
| G4 | **There is one dropdown, and its behaviour is the component's, not each call site's.** Alignment, width and collision handling are settled once in the component so that a page cannot get them wrong and a correction does not have to be made in every page that opens a menu.              | open   |
| G5 | **A dropdown aligns to the right side of the control that opens it, and never extends to the right of it.** A menu that grows rightward off a right-hand control ends up against the edge of the screen, which is how it reads today.                                                         | open   |

**What the code says today.**

- **The one-page-shape component already exists and nothing uses it.**
  `apps/web/src/lib/settings/components/settings-page.svelte` describes itself as "THE STANDARD
  SETTINGS PAGE — one component, everything data-driven", with a stated modularity contract (add a
  setting = one entry in `settings-definitions.ts`). No route renders it. All twenty-three pages
  under `apps/web/src/routes/(app)/settings/` hand-roll the same scroll region instead — the same
  four-line comment, the same `mc-scrollbar min-h-0 grow overflow-y-auto`, the same
  `scrollbar-gutter: stable`, the same `flex flex-col gap-24 p-24` — copied twenty-three times. The
  outer spacing is therefore identical by copy rather than by construction, and the variance the
  owner is seeing is inside the plates, where each page composes its own rows.
- **Five pages use none of the shared parts at all**: `conflicts`, `intake-procedures`,
  `matter-numbering`, `matter-plans`, `versions` render neither `SettingsPlate` nor `SettingsRow`.
- **Two different ways to show a choice are live at once.** Pages driven by `SettingsRow` take the
  control from the setting's declared `kind` (`select`, `switch`, `number`, text); the other pages
  place `RadioGroup`, `Select`, `Checkbox`, `Switch` and `Input` by hand. `design-corrections.md`
  already rules that every closed choice is a combobox — `$lib/components/choice-picker.svelte` —
  which neither path currently honours in Settings.
- **No settings page uses the product's real table.** `event-types`, `notification-policy`,
  `notifications`, `resources` and `users` each use the `DataTable.Root/Header/Row/Head`
  primitives. `DataTable.Grid` — the one with sorting, column filters, the column roster, resizing,
  search, the counts footer and load-more — is used by matters, time, fees, costs, billing,
  directory, intake, discovery and the money surface, and by nothing in Settings.
- **Dropdown alignment is set at the call site, ninety-five times.** `align="end"` appears 95 times
  across the app and `align="start"` 10 times. The design-system contents set no default of their
  own: `select-content.svelte` and `combobox-content.svelte` both pin `min-width:
  var(--bits-floating-anchor-width)` and pass `align` straight through to Bits UI, so a caller that
  omits it gets the primitive's default. `settings-row.svelte` is one of those callers — its
  `Select.Content` carries no `align`, and its control column is pinned to the right of the row at
  `--mc-size-popover`, which is the exact geometry that sends a listbox wider than its trigger off
  the right-hand edge.

### Firm profile and branding

| #  | Ruling                                                                                                                                                                                 | Status |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1 | **Firm Profile carries the firm's identity, not one field.** The empty space under the name is the symptom: the page holds one setting where it should hold what the firm actually is. | open   |
| F2 | **The firm can upload an image, or images, for use across the platform** — branding in the product and marks printed into generated documents.                                         | open   |

**What the code says today.**

- Firm Profile holds exactly one setting, `firm-profile.display-name`, with its own Save. The page's
  own header comment explains the emptiness as deliberate: an address, a telephone number and a
  letterhead root "belong to an OFFICE ... so they live under Offices behind `locations:manage`".
  Offices do not exist in the interface (see the next group), so the space under the name is empty
  and the facts it points at are unreachable.
- **An image upload already exists in the backend, per office rather than per firm.** The per-firm
  schema carries `letterhead_logo_object_key`, `_content_type`, `_size_bytes`, `_sha256`,
  `_width_pixels`, `_height_pixels`, `_width_emu`, `_updated_at` on the location table; the bytes go
  to the firm's R2 bucket; `packages/locations/src/location-service.ts` enforces PNG-or-JPEG and a
  printed width, and audits `location.letterhead_logo_set` / `_cleared`. So the question this round
  actually opens is whether firm branding is firm-wide, per-office, or firm-wide with a per-office
  override — not whether an upload path has to be built from nothing.

### Offices

| #  | Ruling                                                                                                                                                                                                                      | Status |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| O1 | **Offices are settable, from Settings, and there can be several.** Each carries its address, its contact information and its location. There is no way to do this in the product today, which is why it could not be found. | open   |

**What the code says today.** The whole subsystem is built except the screen. `packages/locations/`
owns validation and the service; `apps/api-worker/src/routes/locations.ts` exposes create, update,
close, set-addresses, member assignment and the letterhead logo, with reads open to any firm member
and writes behind `locations:manage`. A location carries a name, jurisdiction, IANA time zone,
numbering code, letterhead address block, footer and remit-to; each of its addresses carries kind,
street, city, region, postal and phone. The web app touches exactly one of these: `matters-api.ts`
reads `/api/v1/locations` to populate a picker. There is no create, no edit, and no way to reach any
of the rest — which is why the owner could not find it. An email address for an office does not
appear in the schema; if offices need one, that is a column and a contract change, not a screen
change alone.

The office record is also what two other staged rows lean on: `W1` in
[`matter-rulings.md`](matter-rulings.md) wants the matter status window's Location to link to it
through one modular component, and the matter's owning office (`matter.locationId`, picked through
`vocabulary-picker.svelte`) is already that same record read from the other end. Building Offices
first is what lets both stop being free text.

### Platform — beta access and versions

| #  | Ruling                                                                                                                                                                                                                               | Status |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| P1 | **"Release Channel" reads "Beta Branch".**                                                                                                                                                                                           | open   |
| P2 | **Cancelling the join leaves the toggle off.** Pressing to join and then cancelling currently leaves the switch showing as active while the firm is still on the released build — the screen says one thing and the firm is another. | open   |
| P3 | **The Versions page reports real information**, not seams standing in for a read that exists.                                                                                                                                        | open   |
| P4 | **Versions and the build information surface are one thing.** They answer the same question in two places; consolidate them rather than keeping two.                                                                                 | open   |

**What the code says today.**

- "Release Channel" is the plate heading on `settings/beta-access`; the row inside it is labelled
  "Beta Programme". P1 renames the heading.
- **The cancel bug is a binding, and it is reproducible from the source.** The page renders
  `<Switch checked={onBeta} onCheckedChange={requested} />`. The design system's `Switch` declares
  `checked = $bindable(false)` and hands it to Bits UI with `bind:checked`, so with no binding from
  the page the component owns its own copy: it flips itself on press, the page opens the consent
  dialog, and cancelling never puts the switch back, because nothing outside the component knows it
  moved. The state that decides the row — `channel` from the session — is untouched, so the screen
  and the firm disagree until the next read. The fix is at the call site (drive the switch from
  `onBeta` through a getter/setter that refuses until the server agrees), not in the component.
- **Versions is stale in a way that is now fixable: the endpoint it says does not exist, exists.**
  `settings/versions/+page.svelte` states that "the backend components ... have no aggregated
  versions endpoint yet" and works around it by decomposing the scan-policy histogram's composite
  `engine/<code>+yara-rules/<tag>+clamav-db/<db>` string behind `firm:manageScanPolicy`, leaving
  em-dash seams for everything else. Meanwhile `apps/api-worker/src/routes/meta-versions.ts` serves
  `GET /api/v1/meta/versions` — "what is running, across the whole deployment" — and the version
  chip in the app shell (`apps/web/src/lib/versions/`) already reads it, renders a row per
  Cloudflare Worker, folds the fleet, flags an API/web sync mismatch, notices an upstream deploy,
  and carries a second section for database health. That chip panel is the build information
  surface P4 asks to consolidate with: the model is `version-overlay-model.ts` and
  `database-health-model.ts`, and the page can be the same model rendered at page size rather than
  a second implementation.

### File safety — the scan tiers

| #  | Ruling                                                                                                                                                                                    | Status |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| S1 | **The scan depth options read "Core", "Extended" and "Full".** Nothing else in the option itself.                                                                                         | open   |
| S2 | **Choosing one shows what its rules are, beneath the engine.** The detail belongs under the engine that runs it, revealed on the choice, rather than crammed into the option's own label. | open   |

**What the code says today.** The three options are declared in
`apps/web/src/lib/file-manager/scan-policy-draft.svelte.ts` with the explanation welded into each
label — "Core — the rules that catch known malware", "Extended — adds the broader threat rules",
"Full — every rule, including the noisiest". S1 cuts each label back to its word. S2 needs somewhere
for the detail to land: the engine's own identity is currently reported on the Versions page (the
scan container's composite `engine/<code>+yara-rules/<tag>+clamav-db/<db>`), and the page's header
comment already records that the threshold "wants to be a plot" over
`/api/v1/firm/scan-policy/score-histogram`. Whether the tier detail and the engine reading belong on
this page or on the consolidated Versions surface is the design question the round opens.

### Matter numbering

| #  | Ruling                                                                                                                                                                     | Status |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M1 | **"Start from" reads "Matter Numbering Scheme".**                                                                                                                          | open   |
| M2 | **Building a scheme is a table.** A part is a row with its fields in columns, edited the way every other list in the product is edited — not a stack of loose fields.      | open   |
| M3 | **The reordering arrows sit on the LEFT of a part, not the right.** They act on the row, and the row begins on the left.                                                   | open   |
| M4 | **The matter numbering screen is reconsidered whole.** The relabelling and the table are the parts already named; the screen itself wants rethinking rather than patching. | open   |

**What the code says today.** Both editors are one component,
`apps/web/src/lib/matters/numbering-scheme-editor.svelte` (506 lines), rendered twice from
`settings/matter-numbering` with `purpose="matter"` and `purpose="consultation"`. "Start from"
(M1) is the starter-template `Select` above the parts list. Each part is a row of loose labelled
fields — Part N, Text, Digits, Starts at, Restarts the count — and the row ends with Move-up,
Move-down and Remove; M3 moves the two arrows to the front of the row. The page renders none of the
shared settings parts, which is the same finding as G1 seen from the other end: a page with a real
editor in it had nowhere standard to put one.
