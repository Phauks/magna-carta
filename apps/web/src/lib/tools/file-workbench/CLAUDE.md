# File Workbench — CLAUDE.md

**Purpose.** The surface a file that belongs to no matter is brought to, and every file capability is run from. A sidebar destination in the Firm group at `/file-workbench`, not a screen inside the Tools area: the ten file utilities in the tool catalog are this screen's own capability tabs, so the host does not belong filed among the things it hosts. One drop, and Type, Hash, Malware Scan, Metadata, Email, Convert, Repair, Text Recognition, Unlock and AI Text all address the same bytes. The boundary is the file's lifetime: nothing here is filed, versioned, or remembered.

**White paper:** _Core domain_ — the Tools area and the file utilities.
**Decision:** `docs/decisions/0415-a-file-nobody-trusts-is-the-reason-the-workbench-exists.md` (until the register assembles it on `main`).
**Owner's rulings on this screen:** [`docs/conventions/file-workbench-rulings.md`](../../../../../../docs/conventions/file-workbench-rulings.md). Read it before changing anything here.

## Key files / entry points

- `capabilities.ts` — **the registry.** The ordered array every other part derives from: the tab strip, the permission gate, the bulk-action set, the Overview's rows.
- `capabilities/<id>.ts` — one self-contained module per capability. Metadata, `applies`, and the optional `summary` row. **DOM-free**: no component ever hangs off a module.
- `capability-panels.ts` — the id-to-component map. The only place a capability meets its panel.
- `capability.ts` — the contract a module satisfies, and the panel props.
- `overview.ts` + `panels/overview-panel.svelte` — the synthesis. Deliberately outside the registry, which is what lets its panel read the registry without a cycle.
- `workbench-file.ts` — the model: `WorkbenchFile`, the typed `CapabilityOutcome`, and the two capability ids the model itself reads.
- `file-facts.ts` — the derived readings (`isImage`, `carriesText`, `describeType`) every module's `applies` asks its question through.
- `ephemeral-source.svelte.ts` — where files come from in this host. The seam a matter host replaces.
- `rail-columns.ts` — what the file list is sorted and filtered by. `row-menu.ts` — what one row's triple-dot menu offers, and when each verb is refused.
- `identify.ts` · `digest.ts` · `conversion-targets.ts` · `drop-target.svelte.ts` — DOM-free logic, each with its own test.
- `file-rail.svelte` — the file list, as `DataTable.Grid`. `workbench.svelte` — the masthead, the grid, the panes and the tab strip. The route is thin: it supplies the source and the permissions and nothing else.
- `workbench-preferences.svelte.ts` — whether the file is drawn, and on which side. Persisted, and held across capability tabs.

## Local conventions

- **Adding a capability is two steps.** Write `capabilities/<id>.ts`, add it to the array in `capabilities.ts`. Nothing else. If a third step is needed, the contract is wrong — fix the contract.
- **A capability with an `awaiting` gets the standard pending treatment** from `parts/pending-capability.svelte`: its real control, disabled, the Soon mark, and the dependency named beneath. Giving it a real surface is a panel, a line in `capability-panels.ts`, and clearing its `awaiting`. Do not hand-write a seventh variation of "not built yet".
- **Never put a component on a capability module.** A panel reaches bits-ui through the design system, and golden rule 2 confines bits-ui to `packages/design-system/src` strictly enough that even naming it in a test config fails the gate. A module carrying a panel makes the whole registry unloadable from a test, which is how the panel map came to exist. `pnpm test apps/web` catches it; the failure reads `Unknown file extension ".svelte"` and points at bits-ui, not at you.
- **The Overview is never edited to add a capability.** A module contributes its row through `summary`. If the Overview needs a row the registry cannot supply, that row is about the file itself, not about a capability, and belongs in `overview-panel.svelte`'s identity block.
- **Absence is typed.** `not-run`, `not-applicable` and `failed` are three different silences and render differently. Never a blank, never `null`.
- **Readings go in a `FactTable`**, which has a heading and edges. Never a bare label-and-value list: the owner's standing ruling is that values are encapsulated, not floating.
- **The file list is the platform grid.** Sorting, filters, show/hide, selection and the footer counts are `DataTable.Grid`'s. This surface declares columns and cells and decides none of that behaviour — there is deliberately no selection module here any more.
- **Copy is title case in headings, and carries no em dashes** (`docs/conventions/design-corrections.md`). Panels state findings; they do not explain the product to the reader.

## Invariants that apply here

- **A scan verdict is a fact about the file, never a gate on the screen.** No capability's `applies` may consult it. `test/file-workbench-capabilities.test.ts` evaluates every capability against the same file under each verdict and fails if any answer differs. A file somebody does not trust is the reason this surface exists.
- **Ephemeral by construction.** This host wires in no history source and no version source, so a record of an unfiled file cannot exist. Do not add one here; a history belongs to the matter host, where it hangs off a record that already exists.
- **A browser digest is feedback, not evidence** (`digest.ts`). Anything going into a record is computed by the server over the bytes the server received. The Hash panel says which it is showing; keep that saying so.
- **Never a false mismatch** (`identify.ts`). A prefix reading that only establishes "this is text" contradicts no extension. The warning is worth something only while it is rare.
- **Golden rule 2** — Tailwind plus `@magna-carta/design-system` only. Every pane here is design-system components.

## Dependencies & contracts

- `@magna-carta/file-type` — the label vocabulary and `claimedExtensionOf`. `identify.ts` produces the same `FileTypeReport` the content service will, so swapping the source is one call.
- `@magna-carta/conversion` — the format graph. `conversion-targets.ts` bridges the two names for a format and takes the intersection across a selection.
- `@magna-carta/access-control` — every capability declares the tool permission that gates it. The grant itself is the seam in `$lib/tools/tool-permissions.ts`, shared with the `/tools` listing.
- `@magna-carta/tools` — the catalog row (`file-workbench`), the ONLY row in the `files` group. The ten sibling manifests that used to sit beside it were these capability tabs under another name and were retired into them. The row stays for one reason: so a `file` in hand can still be offered it through `toolsFor()`. It declares `route: "/file-workbench"`, which is also what takes it out of the Tools listing, the Tools navigation column and the palette's tool provider. `toolRoute()` is the one derivation.
- **`$lib/tools/tool-permissions.ts` names every capability permission by hand.** It has to: the grant set was built from `CATALOG`, and the retired manifests are what used to put these keys in it. Deleting them without this would have emptied the tab strip silently. `file-workbench-capabilities.test.ts` and `file-workbench-destination.test.ts` both hold the hand-written half to this registry.
- **The lay search words for these capabilities live in `tool-presentation.ts`**, on the workbench's synonyms. A member searching "ocr" used to reach a catalog row; now that word has to reach this screen, and nothing else carries it. Adding a capability wants its words added there.

## Gotchas

- **`capabilities.ts` must not import `overview.ts`.** The Overview panel reads the registry; the reverse import would close the cycle. That is why the Overview is not a registry member and why `summaryRowsFor` lives in `capabilities.ts` rather than beside the Overview.
- **`$lib/tools/tool-permissions.ts` deliberately does NOT import this registry.** It names the two non-catalog permissions by hand, because importing the registry from the plain `/tools` listing would pull the workbench into that route's chunk. A test in `file-workbench-capabilities.test.ts` holds the hand-written half to the registry.
- **The rail's ids are `crypto.randomUUID()`, not minted identifiers.** A workbench file is not an entity and never becomes one. A `file_…` handle here would read as a document that exists somewhere.
- **The preview pane is not rendered when there is nothing to draw**, and the reason moves into `file-header.svelte`. Do not reintroduce an always-present pane: an empty frame held open for a picture that is not coming is the thing that was removed. The reader's show/hide choice is a separate axis and holds across tabs — a file with nothing to draw must not clear it.
- **The rail takes a drop without drawing a dropzone.** `DropTarget` is the behaviour on its own, because the design system's `Dropzone` is a visible dashed box and a box over a table either covers the rows or takes their space. Do not put the component back.
- **Arrival and Safety start hidden.** The rail is narrow; four data columns push the name off. Right-clicking a heading and opening Columns shows them, and the grid remembers. Do not "fix" the missing columns by widening the default rail.
- **The grid lives in `workbench.svelte`, not in the rail.** The screen reads and drives its selection (which file the readings are about), and the list has to begin at the top of its pane — both need the grid one level up. There is no columns control on the screen to place: the column controls are the header's own right-click menu.
- **Do not use the grid's `onRowContextMenu` to open a menu.** It calls `preventDefault`, which stops the very menu it is meant to summon. The rail re-targets from its own `oncontextmenu` on a presentational wrapper, which is the matter ledgers' pattern too. A `ContextMenu.Content` behind an `{#if}` on the target never renders either: the menu opens before the condition can become true.
- **Discarding is a row's verb only.** No standing Discard button: one up there acts on whatever happens to be selected, and that is the button that throws away the wrong thing.
- **Nothing is uploaded yet.** The masthead says so, and it is true — the readings that are real happen in the browser. When the firm-scoped scratch object lands, that line changes to the retention promise, and `ephemeral-source.svelte.ts` is the only module that has to.
