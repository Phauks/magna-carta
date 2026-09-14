# Modal headers — the act, and the identifier of what it acts on

**Date:** 2026-09-14
**Status:** Proposed.
**Scope:** The two lines at the top of every modal surface — `ActionDialog`'s and `RecordWindow`'s
`heading` and `subtitle`. A type for the record reference the subtitle is contracted to carry, the
design system's rendering of it, a source scan over the call sites, and the generalization of the
preview-before-save number off the call log.
**Excludes:** the modal shells themselves (settled in
[`2026-09-01-consolidated-modal-architecture-design.md`](2026-09-01-consolidated-modal-architecture-design.md)
and unreopened here), how any number is drawn or rendered by its own domain, the screen header
(which has its own gate in `tooling/lint-screen-headers`), and the failure band.

**Binding inputs, in order of authority:**

- The owner's ruling of **2026-09-08**, _a panel does not explain its own subject in its subtitle_
  ([`design-corrections.md`](../conventions/design-corrections.md)) — the subtitle names what is
  being acted on; it is not the place for a paragraph on what the subsystem is for.
- The owner's ruling of **2026-09-08**, _a record a person quotes out loud carries a NUMBER_ — a
  handle is what the platform joins on and is not something anybody can read back down a telephone.
- The owner's ruling of **2026-09-08**, _a record that is quoted out loud is identified BEFORE it is
  saved_ — where a record carries a reference number a person reads back, the panel states the number
  the next one would draw while it is still being filled in, and says it is a preview.
- The owner's direction of **2026-09-14**, opening this stream: a standardized format for stating
  what the modal does and the identifier of the data being entered, because all data should be
  traceable and therefore all data should have identifiers.
- The `ActionDialog` contract as built
  (`packages/design-system/src/lib/components/action-dialog/action-dialog.svelte`), whose `subtitle`
  already reads "What is being acted on, named once. A record's own reference belongs here and only
  here."

## 1. The rule exists; nothing enforces it

Every part of the format this spec settles is already written down. The shell's own props say it,
the record window's props say it, and the owner ruled on it twice in one day. What is missing is the
only thing that ever made a shared surface hold: a type that makes the wrong shape unsayable, and a
scan that reads the call sites.

The measured state of 82 `ActionDialog` openings across 60 files, at the head of this branch:

| Fact                                                         | Count |
| ------------------------------------------------------------ | ----- |
| Openings carrying a subtitle                                 | 54    |
| Openings carrying none                                       | 28    |
| Subtitles that are explanatory prose rather than an identity | 18    |
| Subtitles mixing an identity and a sentence in one string    | 4     |
| Distinct separators between an identity and a fact           | 3     |
| Panels previewing the number they are about to draw          | 1     |

Eighteen subtitles are the thing the owner struck from the New Check panel on 2026-09-08, still
standing in `file-to-matter`, `set-aside`, `bug-report`, `new-review-set`, `declare-load`,
`add-matter-files`, `new-record-custodian`, `new-packet`, `link-scan`, `add-item`,
`settings-commit-footer`, `invoice-line`, `new-document`, `restore-file`, `beta-access`,
`report-dialog` and `names-pane` twice. Four billing panels put a number and a sentence in one
string behind `·` in three places and `—` in a fourth.

That is not thirty-four authors disagreeing. It is one slot with a `string` type, which is a slot
that accepts anything.

## 2. The format

Two lines, and each answers exactly one question.

**The heading says what the panel DOES.** Its grammatical form follows from the panel's kind, which
the shell already knows:

- An **acting** panel (`form`, `confirm`, `destructive`) takes an **imperative verb phrase** naming
  the act: "Write Off a Balance", "Void This Draft", "Kick Back a Cost". Not "OK", not a name for
  the panel, and **not a question** — "Retire This Event Type?" becomes "Retire This Event Type".
  Forty-seven of the sixty-three literal headings are already this shape, destructive panels
  included; the question mark is the minority and it is what goes.
- A panel that **makes a record** takes **"New &lt;Noun&gt;"**, the noun being the one the create
  control already uses (`apps/web/src/lib/matters/sections.ts` answers `createNoun`). This is not an
  exception invented here — it is the owner's create-control ruling of 2026-09-03 reaching the panel
  the control opens, and it is why "New Packet" is correct rather than drift.
- A **reading** panel takes a **noun phrase naming the thing shown**: "Matter Status", "Time Sheet".
  A panel that asks for nothing cannot be titled with an imperative without promising an act it does
  not offer.

Title case, with interior articles and short prepositions in lower case: "File a Copy", never "File
A Copy". Six headings capitalize them against fourteen that do not, so this settles a live split
rather than inventing a preference.

**The subtitle says WHAT IS BEING ACTED ON, by its identifier.** It is the record's reference number
and a small number of facts about the subject — never a description of the act, the subsystem, or
what will happen. What the panel does is the heading's job and saying it twice invites the two to
disagree.

## 3. The reference is a type, not a string

The centralization is one small shape, in the design system, rendered by the design system.

```ts
/** How firmly a record holds the number it is shown under. */
export type ReferenceStanding = "drawn" | "tentative" | "preview";

export interface RecordReference {
  /** The record kind as a reader says it: "Matter", "Invoice", "Call", "Packet". */
  readonly kind: string;
  /** The number itself, as the record carries it. Null where none has been drawn or previewed. */
  readonly number: string | null;
  /** Defaults to "drawn". */
  readonly standing?: ReferenceStanding;
}

export interface RecordSubject {
  /** What is being acted on, by its number. Absent only where the subject genuinely has none. */
  readonly reference?: RecordReference;
  /** Short facts about that subject — never a sentence about the act. */
  readonly facts?: readonly string[];
}
```

The three standings are the domain's own, not a UI nicety:

- **`drawn`** is the record's permanent number — a matter number, an invoice number.
- **`tentative`** is a number the record really carries and which a permanent one may later join
  rather than replace. The consultation number is the case the platform already models this way
  (`packages/matters/src/numbering/consultation-scheme.ts`): a consultation draws one on graduating
  from intake, keeps it after the matter opens, and a document filed under it still resolves.
- **`preview`** is not drawn at all. It is what the next record would take, shown so the person
  entering it can write it on a slip before the save, and it says so rather than implying a
  reservation.

Rendering is the shell's, in one place:

| Standing    | Number | Renders                                           |
| ----------- | ------ | ------------------------------------------------- |
| `drawn`     | `"…"`  | `Matter 2026-0147`                                |
| `tentative` | `"…"`  | `Consultation 2026-C-0042`                        |
| `preview`   | `"…"`  | `Call 2026-09-08-0042 · drawn when this is saved` |
| any         | `null` | `A number is drawn when this is saved.`           |

The last two rows are the call log's own two branches
(`apps/web/src/lib/communications/communication-record-window.svelte`), lifted out of the one file
that has them. `tabular-nums` rides the number here rather than being retyped — it is currently hand
written 138 times across the web app.

### The slot's type changes

`subtitle` becomes `RecordSubject | Snippet`. **The bare `string` arm is removed**, and that removal
is the whole mechanism: a sentence about the subsystem has nowhere to go, and a fact that is
genuinely a fact says so as one.

```svelte
<!-- before -->
subtitle={`${row?.summary.invoiceNumber ?? "This bill"} · this matter still owes ${money(ceiling)}`}

<!-- after -->
subtitle={{
  reference: { kind: "Invoice", number: row?.summary.invoiceNumber ?? null },
  facts: [`this matter still owes ${money(ceiling)}`],
}}
```

The snippet arm stays for a subject that carries real markup (`entity-window`, `record-parties`),
and it is the one place a call site can still write anything — which is why the scan in section 4
reads it too.

Prose that is load-bearing does not vanish; it moves where the owner's rulings already send it. A
sentence explaining a field goes beside that field (_a field whose meaning genuinely needs a sentence
gets the sentence beside it_, 2026-09-01); a sentence explaining the act is deleted, because the
heading says it.

## 4. The scan

`tooling/lint-modal-headers`, the sibling of `tooling/lint-screen-headers` and built the same way:
pure rules over text in `modal-headers.mjs`, the impure runner in `index.mjs`, a fixture test beside
them. A type stops the shape; a scan stops what a type cannot see.

| Rule                             | What it asserts                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `heading-form`                   | The heading matches its kind: imperative for an acting panel, `New <Noun>` for one that makes a record, a noun phrase for a reading panel. No trailing `?`.                                                        |
| `heading-case`                   | Interior articles and short prepositions are lower case.                                                                                                                                                           |
| `subject-not-prose`              | No fact, and no literal in a subtitle snippet, is sentence-shaped. The 2026-09-08 ruling, enforced.                                                                                                                |
| `subject-declared`               | An acting panel declares a subtitle, or carries an allowance naming why its act has no subject.                                                                                                                    |
| `reference-reaches-the-subtitle` | Where a panel's own source holds a value named for one of the platform's record numbers, that value reaches the subtitle's `reference`. This is what catches a panel that has the number and shows something else. |
| `allowance`                      | Every recorded allowance still describes a real violation, on `lint-one-ui`'s discipline: a list nobody re-reads is how a gate goes quiet.                                                                         |

`reference-reaches-the-subtitle` needs a registry of what counts as a record number, and it must not
be a hand list that goes stale. It is **derived from the schema** — the `*_number` columns of
`packages/database/src/per-firm-schema.ts` — so a record kind that grows a number grows a rule with
it, and the scan fails loudly if it can no longer parse the schema rather than passing vacuously.

## 5. The preview seam

The owner's ruling that a record quoted out loud is identified before it is saved was written
generally and reached one file. `GET /api/v1/communications/next-number` is the only endpoint of its
kind on the platform; `new-packet-dialog` draws a custody number and shows prose in its place,
`new-matter-dialog` draws a matter or consultation number and shows nothing, `draft-bill-dialog`
mints an invoice number and shows the client's name.

The generalization is deliberately a **seam, not an engine**: one client-side helper that turns a
"what would the next number be" read into a `RecordReference` at `preview` standing, and the shell
rendering it. Each domain still owns its own endpoint and its own scope key — a call's number is
scoped to the UTC day, a matter's to the firm's numbering scheme, and folding those into one route
would put every domain's numbering rules in one handler. What is shared is the shape of the answer
and the words the reader is told, which are exactly the parts that were drifting.

Panels that mint a number and gain the preview in this slice are named in the implementation plan;
a panel whose domain has no next-number read yet declares its reference with `number: null`, which
renders the honest "A number is drawn when this is saved." rather than silence.

## 6. Order, and why

1. **The type and its rendering**, then the call sites. A scan over free strings can only ever check
   shapes; a scan over a typed reference checks facts.
2. **The scan.** It is written against the migrated call sites, so it starts green and stays that way
   rather than landing with a list of allowances.
3. **The preview seam.** It depends on `preview` standing existing, and on the shell rendering it in
   one place.

## 7. Test plan

- **Model** (`action-dialog-model` sibling): the rendering table of section 3, asserted directly —
  every standing, and the null-number case, without a DOM.
- **Component**: the reference renders inside both shells' header bands; a `preview` reference
  states it is drawn on save; `tabular-nums` rides the number.
- **Scan**: a fixture test per rule, each with a passing and a failing source, on
  `lint-screen-headers`'s pattern. Plus the schema-parse guard: a schema the registry cannot read
  fails the run.
- **Regression**: the browser harness pins the header band's two lines for one acting panel, one
  creation panel and one reading panel.
