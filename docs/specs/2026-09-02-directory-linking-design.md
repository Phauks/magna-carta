# Directory Linking — One Way to Name a Person Anywhere, and the Matter's Parties Built On It

**Date:** 2026-09-02 · **Status:** Owner-reviewed 2026-09-02 — the questions of §7 are answered and every section they
change has been rewritten to match; slice 1 is built on the branch (see the active-work note
`docs/active-work/claude/directory-ui-person-linking-fcot46.md` for the session handoff) · **Subsystem:** Directory (`packages/directory`, `apps/web/src/lib/directory`,
`apps/web/src/routes/(app)/contacts`), the design system, and every surface that links a record to a
person or an organization — matters first · **Predecessors:**
[`2026-08-30-directory-entity-model-design.md`](2026-08-30-directory-entity-model-design.md) (the
entity model, owner-reviewed) and
[`2026-08-29-ui-port-plan.md`](2026-08-29-ui-port-plan.md) R2, where the file-side equivalent,
`RecordAttachments`, was specified.

**The owner's framing, which this design serves:** build the Directory UI, reaching inside matters;
and build a modular way for callers throughout the app that need person information, or need to link
to person information, to do so — so the platform never again chases the association the way it had
to chase file associations (custodian, time, notes and costs each wanting to say "these files").

---

## 1. What actually exists — verified, not assumed

The finding is the same shape as the entity-model design's: the built surface is much further along
than the trackers say, and the hole is not where the roadmap points.

### 1.1 The Directory UI is real, days old, and owner-reviewed

`roadmap.d/core-domain.md` still says "no entity UI yet" and "UI deferred until the design-system app
shell lands". That is stale. On `main` today:

| Surface                                                  | State                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/contacts` — the list                                   | Built and reviewed by the owner on 2026-08-30: a paged, counted, sortable INDEX of both kinds in one sequence, and a separate ranked, capped SEARCH; one compact action row; one primary action with a kind menu. Nav label is "Directory". |
| `/contacts/{id}` — the record                            | Built. Nine panes: Names, Contact (email/phone/address with permission, preference and verification), Pronouns, Dates, Identifiers (sealed, gated reveal), Duplicates + merge, Relationships, Matters, Categories.                          |
| `apps/api-worker/src/http/routes/directory/directory.ts` | ~40 routes covering every table, including `GET /api/v1/directory/entity-names` — a batched handle-to-name read capped at 100.                                                                                                              |
| `packages/directory`                                     | Complete domain: persons, organizations, temporal names with phonetics and match keys, sealed identifiers, edges, categories, three contact channels, party roles, matter parties, non-destructive merge, fitness probes.                   |
| `apps/web/src/lib/directory/`                            | The API client (`directory-api.ts`), the one naming rule (`entity-presentation.ts`), the one display mark (`entity-identity.svelte`), the label catalogs (`directory-vocabulary.ts`), listing and search rules.                             |

No pane is a fixture; every one reads the firm's own record. What the directory UI itself still
lacks is small and listed in §5 slice 4: edges can be read but not created (`POST
/api/v1/directory/edges` exists; `directory-api.ts` has no client for it), categories can be assigned
but not managed, the two dialogs predate `ActionDialog`, and the Phase G edge catalog
(`officer_of`, `point_of_contact_for`, the `constituent` class) is not built.

### 1.2 The hole is the link, and the matter is where it shows

The model for "this entity plays this role on this matter" is right and already built:
`matter_party` (`packages/database/src/per-firm-schema.ts:1841`) carries the role ON THE LINK, a
free-text `capacity`, validity dates, soft delete, and no uniqueness on (matter, entity) — one person
wears several hats by design. `directory_party_role` is the firm-owned role catalog. The routes exist
(`POST`/`GET`/`DELETE /api/v1/directory/matter-parties`). Billing (`invoice.client_entity_id`), trust
(`trust_ledger_node.client_entity_id`) and document assembly (`directory-role-bindings.ts`) all
DERIVE the client from the `client` party row.

And nothing in the web app can write one:

- `apps/web/src/lib/matters/party-api.ts` has `listMatterParties` and `unlinkMatterParty`. There is no
  `linkMatterParty`.
- `apps/web/src/routes/(app)/matters/[id]/parties/+page.svelte` ships "Add party" disabled behind a
  Soon badge with the sentence: _"Adding a party waits on the directory picker, so that the person or
  organization is chosen from the firm's directory rather than typed twice."_
- `apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte` says the same about _"the
  participant picker"_ for a judge, a court or a witness.
- The matter's client is a **string**. `matter.client_display_name` is commented "display-only until
  the Directory link lands"; `apps/web/src/lib/matters/client-picker.svelte` is a combobox over the
  distinct client strings already on the docket and calls no directory API at all; `matter-intake.ts`
  says outright that the intake conflict check cannot run because a typed name is not an entity.
- `packages/directory/src/client-migration.ts` — a backfill that would have turned those strings into
  entities plus a `client` party — existed with **no production caller**. Deleted in slice 2 on the
  owner's ruling that with no real users there is nothing to back fill.

So today a firm can open a matter, bill it, and hold trust for it, and at no point is the client a
record the directory knows. Every downstream reader that derives the client from `matter_party`
finds nothing.

### 1.3 The duplication the owner is worried about has already happened for people

The file side's history was: three features needed "these files" and each built its own picker before
`RecordAttachments` existed. The person side is at the same point, with the same count:

| Picker                                                   | Shape                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web/src/lib/conflicts/subject-party-picker.svelte` | Combobox over `searchDirectory`, multi-select, chips, excludes already-picked |
| `apps/web/src/lib/custodian/owner-picker.svelte`         | Combobox over `searchDirectory`, single pick, `excluded` list                 |
| `apps/web/src/lib/costs/cost-payee-picker.svelte`        | Combobox over `searchDirectory`, single nullable pick                         |
| `apps/web/src/lib/matters/client-picker.svelte`          | Combobox over docket strings — the odd one out, no directory at all           |

The first three each re-implement the same 250 ms settle, the same three-character floor, the same
capped / searching / search-failed triad, and the same comment about a failed search never rendering
as an empty directory. `apps/web/src/lib/custodian/directory-names.svelte.ts` is a batched
handle-to-name resolver that is generic in shape and custodian-local in home. `entity-identity.svelte`
— the one mark for "this is a person / this is an organization" — is used only inside the directory;
custodian, costs and conflicts each render an entity their own way.

Seventeen migration files declare an `entity_id` column. The association tables — `matter_party`,
`custody_owner`, `matter_asset_interest`, `firm_event_participant`, `email_participant`, conflicts
subjects — are the person-side twins of `time_entry_attachment`, `matter_note_document`,
`matter_asset_document` and `custody_scan`.

### 1.4 What the file side teaches, including the part that did not work

`RecordAttachments` (`packages/design-system/src/lib/components/record-attachments/`) is the right
shape and the plan below copies it deliberately: a data-blind design-system component that never
fetches; an ASSOCIATION identity kept separate from the TARGET's identity (so "already linked?" and
"unlink" are both answerable); pure rules in a tested module beside the markup; a tab-key constant so
two record types cannot spell it differently; "detach is not delete" said in as many words; controls
that are refused with a reason rather than hidden; registration in `tooling/lint-one-ui/registry.json`
the moment the contract is agreed.

Three things about it are lessons rather than precedent:

1. **Landing the component is not the same as adoption.** Its only product consumers today are the
   cost and fee record windows, both stubs (`attachments={[]}`). Notes, time and custodian each built
   their own attachment surface anyway. A shared component that leaves the old copies standing is a
   fourth copy. The person-side plan therefore includes deleting the three pickers, not just adding a
   fourth.
2. **Its picker is a pushed, finite array** (`documentSource`, the matter's folders) because a
   matter's files are a bounded local set. The directory is not bounded, and every existing person
   picker is an async search. The person component needs a search SEAM, not an array.
3. **Its confirm is a hand-composed dialog** and carries an allowance for it. The person component
   builds its confirmation on `ActionDialog` from the first commit.

Two things the person side already has that the file side still lacks: a batched id-to-name route
(`/api/v1/directory/entity-names`) and a one-place naming rule (`entity-presentation.ts`). It starts
from a better position.

---

## 2. The proposal — a directory-linking family, three layers, one seam

**Every surface that names, picks, or links a person or an organization goes through one family of
components, and the only thing a caller supplies is which record it is linking to and how to persist
the link.** No caller ever builds a combobox over `searchDirectory` again; `lint:one-ui` refuses a
second one once the registry entry lands.

### 2.1 Design-system layer — data-blind, three components

Home: `packages/design-system/src/lib/components/`, story-first, token-only CSS, registered in
`registry.json`, each a subpath export. Names in full (golden rule 12).

**`EntityIdentity`** — the mark. Kind glyph (person / organization), name, optional aside, optional
pronoun short form, optional "Folded in" badge, optional link, optional remove control. This is
`apps/web/src/lib/directory/entity-identity.svelte` promoted into the design system with a `size`
axis (a table cell, a chip in a field, a record header) and `onRemove`. It takes a name and facts,
never a fetch — unchanged.

**`EntityPicker`** — the one search-and-choose control. Built on the existing `Combobox` parts.

| Prop                 | Type                                                                  | Notes                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onSearch`           | `(query: string, signal: AbortSignal) => Promise<EntityPickerAnswer>` | **The seam.** The app supplies the directory; the component owns the settle, the floor, the abort of a superseded query, and the three states. Same layering as the `notice` slot on `ActionDialog`.           |
| `selection`          | `PickableEntity \| PickableEntity[] \| null` (bindable)               | Single or multiple is the `multiple` flag, not two components.                                                                                                                                                 |
| `kinds`              | `readonly ("person" \| "organization")[]`                             | What may be offered; a payee picker offers both, a judge picker offers persons.                                                                                                                                |
| `excluded`           | `readonly string[]`                                                   | Handles not offered (already linked, the record itself).                                                                                                                                                       |
| `onCreate`           | `(kind, typed: string) => void`                                       | Given, the list ends in the platform's add row ("Add a person…"); the caller opens quick-create and hands the new entity back through `selection`. A picker that dead-ends is how a name gets typed elsewhere. |
| `minimumQueryLength` | `number`, default 3                                                   | The corpus matches three-character windows; the picker says what is missing rather than doing nothing.                                                                                                         |
| `disabledReason`     | `string?`                                                             | Refused, not hidden.                                                                                                                                                                                           |

`EntityPickerAnswer = { hits: PickableEntity[]; capped: boolean }` and
`PickableEntity = { identifier, name, kind, aside? }`. A capped answer says so in the list, in the
directory's own words, and is never re-sorted. **A field that holds a chosen person shows what it
holds at rest** — the owner's ruling of 2026-08-30 — so the closed picker renders the selection as an
`EntityIdentity`, and arriving in it starts a fresh search.

**`RecordParties`** — the tab, the exact counterpart of `RecordAttachments`. A record's linked people:
a list of `EntityIdentity` rows with the role and capacity beside each, an "Add…" that opens
`EntityPicker` inline with a role field, and an unlink per row that asks first, on `ActionDialog`,
and says the person stays in the directory.

| Prop / export                                                            | Notes                                                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `parties: readonly RecordParty[]`                                        | `{ identifier, entityIdentifier, name, kind, role?, capacity?, linkedAt?, linkedBy? }` — association id and entity id kept apart. |
| `roles: readonly PartyRole[]`                                            | The role vocabulary the caller offers; empty means the link has no role (a note's "who I met with").                              |
| `canEdit`, `linkDisabledReason`                                          | Refused with a reason, never hidden.                                                                                              |
| `onSearch`, `onCreate`                                                   | Passed through to the picker.                                                                                                     |
| `onLink({ entity, role, capacity })`, `onUnlink(party)`, `onOpen(party)` | Fire-and-forget, as attachments.                                                                                                  |
| `PARTIES_TAB_KEY`, `openingTabForParties(count)`                         | The tab-key agreement, taking a count.                                                                                            |
| `unlinkedCandidates(hits, parties)` in `linkable-entities.ts`            | The pure rule, tested on its own.                                                                                                 |

### 2.2 App layer — the one home for directory data, `apps/web/src/lib/directory/`

- `directory-picker-source.ts` — `directoryPickerSearch(fetch, { kinds })` returning the `onSearch`
  the design system asks for, mapping `DirectorySearchHit` to `PickableEntity` through the naming rule
  in `entity-presentation.ts`. One adapter, so a capped answer is worded once.
- `entity-names.svelte.ts` — the batched resolver, promoted from `apps/web/src/lib/custodian/`; one
  request per page over `/api/v1/directory/entity-names`, never one per row.
- `quick-create` — `new-entity-dialog.svelte` migrated onto `ActionDialog` (it is on the migration
  list already) and made openable from any picker's add row; it already returns `onCreated(entityId)`.
- `entity-presentation.ts` stays the only naming rule; `entity-identity.svelte` becomes a thin
  re-export of the design-system component during the move and is then deleted.

### 2.3 Data layer — no new generic table, one documented shape

The file side chose per-feature association tables with the doctrine written into the schema
comment, and rejected a polymorphic link table. The same holds here, for the same reasons plus two of
the directory's own: every association is firm-scoped through the data-access layer and registered
individually in `pii-registry.ts` for subject erasure, and the conflicts engine reads specific tables,
not a polymorphic one. **What is shared is the shape, not the table:** own id handle, the record's id,
`entity_id` (no cross-domain FK — the `matter_party` precedent), optional `role`, optional
`capacity`, `linked_at`, `linked_by`, soft delete, and a uniqueness rule the feature chooses. It is
written down once in `packages/directory/CLAUDE.md`, and a feature adds its table when it is in the
area. `matter_party` already has this shape; nothing about it changes.

---

## 3. Inside matters — what the family is built against first

1. **Parties tab.** "Add party" comes alive: `RecordParties` fed by `listMatterParties`, roles from
   `listPartyRoles` (the `directory_party_role` catalog, with the platform's add row for a role the
   firm has not named yet), capacity as free text, `linkMatterParty` added to `party-api.ts`. The
   page's own removal dialog moves onto `ActionDialog`, which clears its allowance.
2. **The client becomes a party, and there is no matter without one. BUILT on the branch, 2026-09-02.** The intake's client field
   becomes an `EntityPicker` over both kinds (quick-create follows the owner's later ruling on §7
   Q-4), and creating the matter — `open` or `prospective` alike, because a prospective matter's
   conflict check needs a person — writes the `client` party row in the same request. `client_display_name`
   keeps being written as the denormalized display until the contract step; readers switch to the
   party. The backfill that would have linked existing matters is deleted rather than given a caller: with no
   real users there is nothing to back fill, and a matter that predates the link is re-created.
   The intake's conflict control becomes usable, because the client is now an entity.
3. **The matter's Overview** names the client as an `EntityIdentity` linking to the directory
   record. Not the header: its citation line is ruled to be ONE string that ellipsizes, never a row
   of spans, so a link cannot live in it. The Matters pane on the directory record already lists
   the reverse.

---

## 4. Everywhere else — the callers that fold onto the family

| Caller                            | Today                                       | After                                                                                     |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Conflicts subject picker          | Own combobox, multi-select                  | `EntityPicker multiple`                                                                   |
| Custodian owner / depositor       | Own combobox                                | `EntityPicker`; `RecordParties` on the packet window for the packet's people              |
| Cost payee                        | Own combobox                                | `EntityPicker`                                                                            |
| Calendar participants             | Disabled, "waits on the participant picker" | `RecordParties` with `kinds` per role (judge: person; court: organization)                |
| Directory Relationships pane      | Read-only                                   | `EntityPicker` for the far end plus the edge type; `createDirectoryEdge` client           |
| Time entries, notes               | No person link at all                       | `RecordParties` as a tab once the feature adds its association table — the shape is ready |
| Document assembly, billing, trust | Derive from `matter_party`                  | Unchanged, and now find a client                                                          |

---

## 5. Slices, in order — each complete through every layer

**Slice 1 — the family, and the matter's parties. BUILT on the branch, 2026-09-02.** `EntityIdentity`, `EntityPicker`,
`RecordParties` in the design system (stories, axe, VRT, `registry.json`, package exports, CSS
cascade position pinned by test); `directory-picker-source.ts`; the parties tab live; `linkMatterParty`;
the parties page's dialog on `ActionDialog`; the route renamed from `/contacts` to `/directory`; user
doc for adding a party; changelog fragment; `roadmap.d/core-domain.md` corrected (the directory nodes'
status and evidence are stale today).

**Slice 2 — the client is a party. BUILT on the branch, 2026-09-02.** Intake picker with quick-create; the `client` party written at
open; the never-called backfill deleted; the client mark on the overview; intake conflict check enabled; `party-api.ts`
and `matter-intake.ts` updated; migration notes in `packages/database` if any column is touched (none
is expected — this slice is writes into an existing table).

**Slice 3 — no second implementation left standing. BUILT on the branch for conflicts and costs, 2026-09-02; the custodian's copy folds when its stream lands.** Conflicts, custodian and costs pickers replaced
and deleted; the name resolver promoted; `entity-identity.svelte` retired; `lint:one-ui` registry
entries so a hand-built directory combobox fails the gate. This slice waits on the custodian
refinements stream (`docs/active-work/claude/custodian-refinements-19iycw.md`, in review) landing,
because it owns `apps/web/src/lib/custodian`.

**Slice 4 — the directory record finishes. IN BUILD on the branch, 2026-09-02; the edge catalog's fifth `constituent` class is deferred to the owner's conflicts pass, and the new membership types are classed `control` meanwhile, the over-inclusive direction.** Relationships pane gains create (with Phase G's edge
catalog and its `edge-classes.ts` classifications in the same change, since the coverage test requires
it); an organization record gains a People pane and a person record an Organizations pane, both read
from edges; category management; `merge-dialog.svelte` and `new-entity-dialog.svelte` on
`ActionDialog`, clearing their allowances.

**Slice 5 — the remaining callers. RE-SCOPED, 2026-09-02.** The calendar page has no event or
deadline form — only a listing — so there is nothing for a participant picker to attach to, and its
"waits on the participant picker" line was wrong about its own dependency; it now names the forms.
The calendar's own design keeps a judge an `external` participant by default and makes a directory
entity optional, so when the calendar stream builds those forms it consumes the family as a seam:
`participantKind: "entity"` is an `EntityPicker` pick (a `RecordParties` tab where the event opens
in a record window), `external` is a name, `member` is the member picker. Nothing is built here for
it. Likewise time and notes. Calendar participants; then time and notes when those streams are
in the area.

Each slice: schema (where any) → data-access → API → UI → tests → user doc → `changelog.d/` fragment,
in one branch, verified with `pnpm check:scoped` and the tests it carries, because a merge to `main`
deploys.

---

## 6. What was considered and rejected

- **Keeping the picker in `apps/web` and out of the design system.** Every existing picker is app
  code and there are three of them; the app layer is where the copies came from. The design system
  with an injected `onSearch` keeps the component data-blind (the `notice`-slot precedent) and puts it
  where `lint:one-ui` can refuse a second one.
- **One polymorphic `record_entity_link` table.** Rejected for the reasons the file side rejected its
  twin, plus erasure registration and the conflicts engine's per-table reads.
- **A `client_entity_id` column on `matter`.** The client is a ROLE, which is why `matter_party` has no
  uniqueness on (matter, entity) and why billing already derives it from the party row. A second home
  for the same fact is the drift this design exists to end.
- **Making `EntityPicker` a modal.** The modal design settled that a search-and-choose surface is a
  launcher, not an act; the picker is a field, and `RecordParties` is tab content, exactly as
  `RecordAttachments` is.

---

## 7. The owner's rulings — every question of this section is answered

Put to the owner on 2026-09-02 and answered the same day. Kept with their answers so the reasoning
behind a settled decision is the part that stops it being re-litigated.

**Q-1 — The search seam lives in the design system. Answered: yes.** `EntityPicker` takes `onSearch`
and never fetches; the app supplies the directory.

**Q-2 — Is a client required to open a matter? Answered: required for `open` AND for `prospective`.**
The owner's reasoning settles it better than the recommendation did: a prospective matter has a
conflict check, and a conflict check needs a person. So there is no matter without a client party,
whatever its status, and §3 is rewritten to match — the intake refuses to create a matter of either
status without a chosen or newly created client entity.

**Q-3 — `/contacts` or `/directory`? Answered: `/directory`.** Renamed in slice 1, while the address
is built in one function (`entityRecordHref`) and one navigation entry. The old route is not kept as
a redirect: nothing outside the app has linked to it yet, and a redirect that nobody needs is a second
address to keep true.

**Q-4 — Quick-create from a picker: the full dialog or a two-field one? Deferred by the owner** until
the work is closer. Slice 1 therefore ships the picker WITHOUT an add row: a person the directory does
not hold is created on the directory screen first, which is the same act one step away. `onCreate`
stays in the contract as an optional prop so wiring it later is a caller change, not a component
change; nothing about the picker's shape depends on the answer.

**Concurrent stream, noted rather than ruled on: the consolidated matter search**
(`claude/matter-consolidated-search-yba72d`, in active development). It is a search WITHIN a matter
over the matter's own records — files, notes, custodian items, time, costs, calendar, assets, and the
matter's parties by display name, read through `matter_party` — and it never reaches into the
directory as a whole. It is therefore not the picker's search and does not change this design: the
picker's seam is the directory's own ranked name search, which is the only thing that finds a maiden
name. What the two streams share is files: `apps/web/src/lib/matters/matter-header.svelte`,
`apps/web/src/lib/matters/sections.ts` and `roadmap.d/core-domain.md`. Slice 1 stays off the first
two, and the matter header's client mark (§3 item 3) lands in slice 2 after that branch does.

### 7.1 The rulings of 2026-09-03 — the New Person screen and the two models it rebuilt

Put to the owner after the first stream merged, on the live site and on a canvas of four mockups,
and answered the same day.

**R-1 — Every field of a person's record is reachable at creation. Answered on the canvas: direction
B, the side rail.** Not a wizard and not a long column: the record's sections stand as a vertical
rail with a count each, the chosen section's fields beside it, and the duplicate gate on the right,
permanently in view, with a summary of everything the record will hold so nothing behind a rail item
is out of sight. The draft is recorded in ONE request and one batch (`createPersonRecord`), so a
person is never half-recorded and a retry never makes a second one. The sections are components of
their own under `apps/web/src/lib/directory/sections/`, used by the dialog to draft and by the
record's panes to persist, so entering a thing and reading it back are one design. The three
directions not taken (tabs across, one sheet, the record window from birth) stay on the canvas.

**R-2 — Pronouns are a dropdown.** The sets most people state are offered by name; "Another set…"
opens the five forms with the verb agreement, because a label names two of five and a document needs
all of them.

**R-3 — Identifiers are shapes.** "Recording identifiers is not smart": the type decides the fields
and checks the form before anything is sealed — a social security number is nine digits that format
as typed, an employer number nine in two groups, a licence is the region that issued it plus its
number, a bar number its jurisdiction plus its number. "An account number is bare … you would need
multiple fields": an account is who it is held with plus the number, with the username and secret
that belong to it, sealed as one value and blind-indexed on the number alone. The check lives once
(`packages/directory/src/identifier-shape.ts`) and the API and the screen refuse the same values
with the same sentence. `directory_identifier` gains a plaintext `label` (the region, the
jurisdiction, who an account is held with) so the list can say what it holds without a reveal.
"Date of birth is already elsewhere": the `dob` kind leaves the catalog, and the sealed
`client.dateOfBirth` merge field goes with it; a plain merge field from the person's own date column
is a document-assembly follow-up.

**R-4 — Duplicates is not a tab; it is the gate.** The check runs beside the entry, on the right, as
the new record is typed. The record's own Duplicates pane stands until the merge flow moves into
the gate's shape.

**R-5 — A category is not a thing a person has.** "wtf is a category for a person": the section
applies to organizations only (court, vendor, expert firm). The pane and the catalog are unchanged
for organizations.

**R-6 — Contact is four kinds, chosen first, and dense.** "What is being recorded is Type;
telephone and fax should be separate": Email, Telephone, Fax, Address, and the kind decides the
fields. An email is refused without a mailbox and a domain, by one rule shared with the API
(`packages/directory/src/email-address.ts`). A number carries its country from a dial-code control
and formats as it is typed in that country's national form (`libphonenumber-js`, the memory-safe
port the workspace already carried through `class-validator`); what is stored is the international
form with the region beside it, and what is shown is national at home and international abroad.
The list is one line per way to reach them — the kind as a glyph, the use beside the value, the
record's marks after — in place of three tables, one per channel.

### 7.2 The ruling of 2026-09-05 — a record is one window, wherever it opens

Put to the owner after the first walk from a matter into a person: the parties tab opened the
person as a screen in the directory, and the way back at the top of that screen led to the
directory's list rather than to the matter the reader had just left. Three shapes were weighed — an
origin-aware way back (a stack of where the reader had been), a record window over the matter, and
a breadcrumb trail — and the owner ruled for the second, and then for more than the second.

**R-7 — A directory record has ONE surface, and it is the New Person screen's shape.** "If we
stick only to the modal, we reduce to one surface, and it is easy to have in multiple locations."
The record opens in the entity window (`apps/web/src/lib/directory/entity-window.svelte`) on the
action dialog's reading kind at record width: the record's sections as a rail on the left, the
chosen section's pane beside it, and on the right what stands about the record as a whole. The
panes are the same components the record screen composed, so nothing about how a fact is recorded
moved; what moved is where they stand. The tabbed record screen is deleted. Reading a person back in
the geometry they were created in is what the shared sections were for, and now it is literally so.

**R-8 — It opens over the reader's work and closes back to it, so no way back is needed.** From a
matter's parties, from the client fact on the overview, from a conflicts hit, and from the
directory's own list, the window opens in place. The path that made the header's way back lie is
gone, and the way back on every remaining screen leads to the screen above it, as the registry
model assumes. An origin stack was rejected as "hard to keep track of over time"; a breadcrumb
trail asserts a nesting that does not exist, since a person is not under a matter.

**R-9 — The address is the directory's, carrying the record.** `entityRecordHref` now builds
`/directory?record=<id>`: the directory list opens the window from its address, a subject swapped
inside the window is mirrored back into the address in place, and closing takes it out. The old
`/directory/<id>` route survives as a redirect so a link written before this ruling still lands.
Opened from a matter, the window leaves the matter's address alone; only the directory host writes
the record into the address, so a matter's URL never claims to be a person.

**R-10 — A related record opened from inside the window swaps its subject; one opened from another
window stacks once.** A duplicate candidate, a related organization, the record this one was folded
into: each replaces the window's subject rather than raising a second window. A record opened from
the conflicts hit window — itself a window — opens over it, one level and no more. The two acts
that ask a question of their own (changing the name on the record, folding a duplicate in) keep
their panels over the window.

**R-11 — The host contributes only what it alone knows.** A matter hands the window the roles the
record holds on it, one line per association with the capacity beside the role
(`apps/web/src/lib/matters/party-standing.ts`), shown above the record's own facts. The directory
hands nothing. No host describes the record itself; the window does, one way.

---

## 8. Test plan

- Design system: stories per state for all three components (empty, searching, capped, failed,
  refused, selected, multiple); axe on every story; pure rules (`unlinkedCandidates`, the tab key,
  the settle and abort behaviour) unit-tested; the CSS cascade position pinned.
- App: the parties page adds and removes a party against the Miniflare worker; the intake writes the
  `client` party and the overview reads it back; a failed
  search never renders as an empty directory (the sentence every copy carried, now asserted once).
- Gates: `lint:one-ui` registry entries for the three components; `lint:process-refs` clean; the
  parties page and both directory dialogs drop out of the allowance list in the same commits that
  migrate them.

## 9. Documentation

Developer: this spec; `packages/directory/CLAUDE.md` gains the association shape; the design-system
`CLAUDE.md` gains the picker's seam rule. User: `docs/user/` gains "Adding a party to a matter" and
"Choosing the client when opening a matter". Trackers: `roadmap.d/core-domain.md` corrected in slice 1;
`changelog.d/` fragment per slice; `status.d/1-3-directory.md` `ui:` flipped when slice 4 lands.
