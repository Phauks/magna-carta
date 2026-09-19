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

The owner's notes of 2026-09-11, staged and then built the same day. The research beneath each
group is what the code said when the round was recorded; the notes block at the end of the round
records what was decided in building it and the seams it left. Rows still `open` are named there
with the reason.

### The surface itself — consolidation

| #   | Ruling                                                                                                                                                                                                                                                                                        | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| G1  | **Every settings page is built from one page shape.** One scroll region, one plate rhythm, one row grid, one set of spacings — so changing how a settings page looks is one edit rather than twenty-three. A page with a bespoke need composes the same parts; it does not re-implement them. | settled |
| G2  | **A choice is shown the same way wherever it appears in settings.** The page does not get to pick between a radio group, a select and a switch on its own — the setting's declaration says what it is and the shape follows from that.                                                        | settled |
| G3  | **A settings table is the product's table, with everything the product's tables do** — sort, filter, the column roster, resizing, the counts strip. A register in Settings is not a lesser table than a register anywhere else.                                                               | settled |
| G4  | **There is one dropdown, and its behaviour is the component's, not each call site's.** Alignment, width and collision handling are settled once in the component so that a page cannot get them wrong and a correction does not have to be made in every page that opens a menu.              | settled |
| G5  | **A dropdown aligns to the right side of the control that opens it, and never extends to the right of it.** A menu that grows rightward off a right-hand control ends up against the edge of the screen, which is how it reads today.                                                         | settled |

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

| #   | Ruling                                                                                                                                                                                 | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| F1  | **Firm Profile carries the firm's identity, not one field.** The empty space under the name is the symptom: the page holds one setting where it should hold what the firm actually is. | settled |
| F2  | **The firm can upload an image, or images, for use across the platform** — branding in the product and marks printed into generated documents.                                         | settled |

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

| #   | Ruling                                                                                                                                                                                                                      | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| O1  | **Offices are settable, from Settings, and there can be several.** Each carries its address, its contact information and its location. There is no way to do this in the product today, which is why it could not be found. | settled |

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

| #   | Ruling                                                                                                                                                                                                                               | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| P1  | **"Release Channel" reads "Beta Branch".**                                                                                                                                                                                           | settled |
| P2  | **Cancelling the join leaves the toggle off.** Pressing to join and then cancelling currently leaves the switch showing as active while the firm is still on the released build — the screen says one thing and the firm is another. | settled |
| P3  | **The Versions page reports real information**, not seams standing in for a read that exists.                                                                                                                                        | settled |
| P4  | **Versions and the build information surface are one thing.** They answer the same question in two places; consolidate them rather than keeping two.                                                                                 | settled |

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

| #   | Ruling                                                                                                                                                                                    | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| S1  | **The scan depth options read "Core", "Extended" and "Full".** Nothing else in the option itself.                                                                                         | settled |
| S2  | **Choosing one shows what its rules are, beneath the engine.** The detail belongs under the engine that runs it, revealed on the choice, rather than crammed into the option's own label. | settled |

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

| #   | Ruling                                                                                                                                                                     | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| M1  | **"Start from" reads "Matter Numbering Scheme".**                                                                                                                          | settled |
| M2  | **Building a scheme is a table.** A part is a row with its fields in columns, edited the way every other list in the product is edited — not a stack of loose fields.      | settled |
| M3  | **The reordering arrows sit on the LEFT of a part, not the right.** They act on the row, and the row begins on the left.                                                   | settled |
| M4  | **The matter numbering screen is reconsidered whole.** The relabelling and the table are the parts already named; the screen itself wants rethinking rather than patching. | settled |

**What the code says today.** Both editors are one component,
`apps/web/src/lib/matters/numbering-scheme-editor.svelte` (506 lines), rendered twice from
`settings/matter-numbering` with `purpose="matter"` and `purpose="consultation"`. "Start from"
(M1) is the starter-template `Select` above the parts list. Each part is a row of loose labelled
fields — Part N, Text, Digits, Starts at, Restarts the count — and the row ends with Move-up,
Move-down and Remove; M3 moves the two arrows to the front of the row. The page renders none of the
shared settings parts, which is the same finding as G1 seen from the other end: a page with a real
editor in it had nowhere standard to put one.

### Numbering — every sequence on one screen (2026-09-18)

The Matter Numbering screen became Numbering when every sequence the firm draws joined one
register (`docs/decisions/pending/every-number-the-firm-issues-is-drawn-from-one-register.md`).
The design review of the new screen left four judgment calls; the owner ruled on 2026-09-18.

| #   | Ruling                                                                                                                                                                                                                                            | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| N1  | **A fixed sequence is its own plate.** Invoice, time entry and call numbers are three different structures, so three plates, not one "Fixed Shapes" plate with a row each.                                                                        | settled |
| N2  | **"Custody Packet Numbers".** The plate is named for the record the number is on, as the register's subject is.                                                                                                                                   | settled |
| N3  | **Every member sees the inventory read-only.** A member without `matters:manageNumbering` sees what is in force for every sequence with Request a change beside it, never a refusal; reading rides `matters:viewNumbering`, seeded to every role. | settled |
| N4  | **Add Part is the list's last row**, under the entry-row ruling in `design-corrections.md`; the owner left the placement to the rule.                                                                                                             | settled |

**What the code says today.** `apps/web/src/routes/(app)/settings/numbering/+page.svelte` lists
every purpose from `GET /api/v1/numbering-schemes`; a scheme-shaped purpose renders
`numbering-scheme-editor.svelte` with the parts its purpose allows, a fixed one an In Force row in
the value posture. The loading fixture is the settled anatomy (eight plates), a failed read is the
region's own state, and the page asks the shared `sessionPermissions` reader for its posture.

### Notes recorded this round

Decisions taken in building G1–G3, P1–P4, S1–S2 and M1–M4, and the seams left. G4/G5 (the
dropdown's own alignment) are the design system's and were built there; F1/F2 and O1 are their own
stream.

- **The standard page renders a server-backed draft, not the local-storage registry.**
  `settings-page.svelte` was written for `settings-definitions.ts`, whose array is empty by rule
  (every firm setting has a server behind it now), so "adopt the standard page" meant rewriting it
  around what the pages actually hold: a draft of the server-backed shape plus its declared
  definitions. Billing, Calendar, Reports and File Safety render `<SettingsPage>`; a page's one
  bespoke need rides a snippet (`afterRow` for content beneath one row, `plateEnd` for a line that
  closes a plate) rather than a second implementation. The read-only member's "Request a change"
  affordance lives there as before. The scroll region is one component
  (`settings-scroll-region.svelte`) on every page this stream owns; `firm-profile`, `offices`,
  `conflicts` and `ai` belong to other streams and still carry the hand-rolled copy — swapping it is
  one import and two tags each.
- **A plate's closing line is a component** (`settings-plate-note.svelte`): the one sentence a plate
  may carry, in the row rhythm, for a consequence and never an explanation. The ad-hoc `py-8` and
  `py-12` paragraphs and the hand-built rows on Downloads and Notification Policy are settings rows
  now, so spacing inside a plate comes from the row and never from the page.
- **Every closed choice in Settings is the product's combobox.** `SettingsRow`'s `select` kind
  renders `choice-picker.svelte`; the hand-placed `Select`s on Text (the Soon seams), the two
  notification matrices, the Event Types, Resources and Users dialogs, Matter Plans, Intake
  Procedures and the numbering editor are the same field. Where a choice used the empty string for
  a real answer ("No role", "No office", "No template", "Members choose", "Every kind of matter"),
  that answer now carries a value of its own, because the combobox refuses an empty pick and the
  answer is a real one.
- **The five settings tables are `DataTable.Grid`** over column models in
  `apps/web/src/lib/settings/catalog-columns.ts`: the name anchors every row, every set filter hands
  the grid its declared vocabulary, and the Actions column is part of the model, pinned to the
  trailing edge and present only for a member who may act. The grid fixes its columns when it is
  made, so a catalog page re-creates its grid when the session lands — before anyone has sorted or
  filtered. The notification matrices carry the category's meaning as the row's second line
  (`rowDetail`), never a column. The design system's table needed nothing.
- **P2 is a binding.** The switch is driven from the session's channel through a getter/setter
  (`release-channel-switch.ts` holds the two rules; `beta-access-page.test.ts` pins them, the
  page's binding, and the mounted page itself walked through press-and-cancel), so a cancelled
  consent leaves it off because nothing it reads has changed.
- **P3/P4: the Versions page IS the version chip's report.** The body of the chip's popover moved
  whole into `version-report.svelte` (the chip keeps its trigger); the page renders it at page size
  inside one plate, every section, fold and health row included. The histogram decomposition is
  gone from the page, and so is the "once the versions endpoint ships" line — the endpoint has
  shipped. The source-read tests in `version-overlay.test.ts` and `database-health.test.ts` now
  read the report.
- **S2: the engine reading sits on File Safety, beneath Scan Depth, from the score-histogram
  route.** `GET /api/v1/meta/versions` reports the scan Worker's build, not the container's
  composite engine version; the histogram route is the one place the engine states it, and it names
  the same permission the policy read does, so the page reads it and `scan-engine-version.ts`
  splits it. What a depth MEANS is stated from the verdict model and the container's own notes
  (the packages nest; the antivirus signatures and structural checks count at every depth;
  heuristic rules count only above the threshold). The rule FAMILIES inside each package are the
  upstream release's and nothing in this repository lists them, so that line ships as the honest
  Soon seam — never an invented list.
- **M4, what changed on the screen.** The page is the settings anatomy: masthead, the shared scroll
  region, one plate per sequence headed "Matter Numbers" / "Consultation Numbers". Inside each
  plate: an "In Force" row stating the committed scheme (with "Not set" / "Built-in sequence" as its
  badge and the consequence of an unset scheme as its description); the "Matter Numbering Scheme"
  row (M1), a combobox over the common shapes that loads the list and empties again, because a
  field still naming a shape the table below contradicts would be lying; the parts as a table with
  the arrows leading the row and Remove ending it (M2, M3), where a column a part has no fact for
  holds its control refused with the reason on its hover rather than removed; a "Preview" row with
  the server's rendering and the sample sentence beneath; and the plate's own Discard and Save with
  the one consequence line beside them. The information Alert that opened the page is gone ("no
  info lines"); the explanation lives in `docs/user/admin/matter-numbering.md`. The bordered box
  around the editor is gone with it.
- **Seams left.** The settings section nav (`settings/+layout.svelte`) is untouched pending the
  `NavigationLayout` component; the four pages of other streams still hand-roll the scroll region;
  `RequestChangeDialog`'s "File Request" stays the Soon seam it was.
