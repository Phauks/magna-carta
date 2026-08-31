# File Workbench — CLAUDE.md

**Purpose.** The Tools surface a file that belongs to no matter is brought to, and every file capability is run from. One drop, and Type, Hash, Malware Scan, Metadata, Email, Convert, Repair, Text Recognition, Unlock and AI Text all address the same bytes. The boundary is the file's lifetime: nothing here is filed, versioned, or remembered.

**White paper:** _Core domain_ — the Tools area and the file utilities.
**Decision:** `docs/decisions/pending/a-file-nobody-trusts-is-the-reason-the-workbench-exists.md` (until the register assembles it on `main`).

## Key files / entry points

- `capabilities.ts` — **the registry.** The ordered array every other part derives from: the tab strip, the permission gate, the bulk-action set, the Overview's rows.
- `capabilities/<id>.ts` — one self-contained module per capability. Metadata, `applies`, and the optional `summary` row.
- `capability.ts` — the contract a module satisfies, and the panel props.
- `overview.ts` + `panels/overview-panel.svelte` — the synthesis. Deliberately outside the registry, which is what lets its panel read the registry without a cycle.
- `workbench-file.ts` — the model: `WorkbenchFile`, the typed `CapabilityOutcome`, and the two capability ids the model itself reads.
- `file-facts.ts` — the derived readings (`isImage`, `carriesText`, `describeType`) every module's `applies` asks its question through.
- `ephemeral-source.svelte.ts` — where files come from in this host. The seam a matter host replaces.
- `identify.ts` · `digest.ts` · `selection.ts` · `conversion-targets.ts` — DOM-free logic, each with its own test.
- `workbench.svelte` — the three panes and the tab strip.

## Local conventions

- **Adding a capability is two steps.** Write `capabilities/<id>.ts`, add it to the array in `capabilities.ts`. Nothing else. If a third step is needed, the contract is wrong — fix the contract.
- **A capability with no engine yet declares no `panel`.** It gets the standard treatment from `parts/pending-capability.svelte`: its real control, disabled, the Soon mark, and `awaiting` named beneath. Giving it a real surface is adding the `panel` field. Do not hand-write a seventh variation of "not built yet".
- **The Overview is never edited to add a capability.** A module contributes its row through `summary`. If the Overview needs a row the registry cannot supply, that row is about the file itself, not about a capability, and belongs in `overview-panel.svelte`'s identity block.
- **Absence is typed.** `not-run`, `not-applicable` and `failed` are three different silences and render differently. Never a blank, never `null`.
- **Copy is title case in headings, and carries no em dashes** (`docs/conventions/design-corrections.md`). Panels state findings; they do not explain the product to the reader.

## Invariants that apply here

- **A scan verdict is a fact about the file, never a gate on the screen.** No capability's `applies` may consult it. `test/file-workbench-capabilities.test.ts` evaluates every capability against the same file under each verdict and fails if any answer differs. A file somebody does not trust is the reason this surface exists.
- **Ephemeral by construction.** This host wires in no history source and no version source, so a record of an unfiled file cannot exist. Do not add one here; a history belongs to the matter host, where it hangs off a record that already exists.
- **A browser digest is feedback, not evidence** (`digest.ts`). Anything going into a record is computed by the server over the bytes the server received. The Hash panel says which it is showing; keep that saying so.
- **Never a false mismatch** (`identify.ts`). A prefix reading that only establishes "this is text" contradicts no extension. The warning is worth something only while it is rare.
- **Golden rule 2** — Tailwind plus `@magna-carta/design-system` only. Every pane here is design-system components; the one inline style in the rail is a token reference for the scan dot's colour.

## Dependencies & contracts

- `@magna-carta/file-type` — the label vocabulary and `claimedExtensionOf`. `identify.ts` produces the same `FileTypeReport` the content service will, so swapping the source is one call.
- `@magna-carta/conversion` — the format graph. `conversion-targets.ts` bridges the two names for a format and takes the intersection across a selection.
- `@magna-carta/access-control` — every capability declares the tool permission that gates it. The grant itself is the seam in `$lib/tools/tool-permissions.ts`, shared with the `/tools` listing.
- `@magna-carta/tools` — the catalog row (`file-workbench`) that puts this on the listing.

## Gotchas

- **`capabilities.ts` must not import `overview.ts`.** The Overview panel reads the registry; the reverse import would close the cycle. That is why the Overview is not a registry member and why `summaryRowsFor` lives in `capabilities.ts` rather than beside the Overview.
- **The rail's ids are `crypto.randomUUID()`, not minted identifiers.** A workbench file is not an entity and never becomes one. A `file_…` handle here would read as a document that exists somewhere.
- **The preview pane is not rendered when there is nothing to draw**, and the reason moves into `file-header.svelte`. Do not reintroduce an always-present pane: an empty frame held open for a picture that is not coming is the thing that was removed.
- **Nothing is uploaded yet.** The masthead says so, and it is true — the readings that are real happen in the browser. When the firm-scoped scratch object lands, that line changes to the retention promise, and `ephemeral-source.svelte.ts` is the only module that has to.
