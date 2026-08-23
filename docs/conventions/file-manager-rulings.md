# Matter file manager — the owner's standing rulings

Every ruling the owner has issued on this screen, cumulative, newest round last. **A ruling here is
settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round that
silently reverts one is a regression, not a redesign.

Read this file before changing the screen, and check the built screen against it after. Do not
rebuild the screen from scratch: edit it. Regeneration is what loses these.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

## R1 — shell and navigation

| #   | Ruling                                                                                                                            | Status                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| N1  | The screen lives inside the existing app shell; it is not a full-page takeover.                                                   | settled                           |
| N2  | Selecting a file does **not** darken the screen. It behaves like the workbench, not a modal.                                      | settled                           |
| N3  | Back, forward and up buttons, all three, in the file-manager toolbar.                                                             | **regressed** — forward is absent |
| N4  | The breadcrumb root is a **home icon**, not the word "Files".                                                                     | **regressed** — renders "Files"   |
| N5  | Back/forward/up hovers say just "Back", "Forward", "Up" plus the shortcut. Not verbose.                                           | settled                           |
| N6  | Breadcrumbs use the compact spacing.                                                                                              | settled                           |
| N7  | The top header carries the breadcrumbs and the New button; the left sidebar starts beneath it.                                    | settled                           |
| N8  | Scrolling down reduces the top chrome to give the list more height.                                                               | settled                           |
| N9  | Carets in the left sidebar expand and collapse nesting.                                                                           | settled                           |
| N10 | No reflow in the left sidebar when a folder is selected.                                                                          | settled                           |
| N11 | Reserved, themed scrollbar space in the left sidebar; also on the right of the file list; the horizontal scrollbar is themed too. | settled                           |
| N12 | Right-click works in the left sidebar, not only in the list.                                                                      | settled                           |
| N13 | One button toggles expand-all / collapse-all, not two.                                                                            | **open** (R5)                     |

## R2 — search

| #   | Ruling                                                                                                                                                                                                         | Status                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| S1  | The matter search sits **next to the matter status chip** (e.g. "Open"), not in the app header and not in the file-manager toolbar. It searches the whole matter — billing and time included — not just files. | **regressed** — it is in the file-manager toolbar |
| S2  | It expands from an icon and collapses when unused.                                                                                                                                                             | settled                                           |
| S3  | No `x` clear button in that field.                                                                                                                                                                             | settled                                           |
| S4  | Scope is a dropdown, not oversized circular buttons; the dropdown aligns to the left edge of the field.                                                                                                        | settled                                           |
| S5  | Search covers file **names and contents**.                                                                                                                                                                     | settled                                           |
| S6  | Show search progress and status, not a prose explanation of how indexing works.                                                                                                                                | settled                                           |
| S7  | A result names its full breadcrumb, not just the parent folder.                                                                                                                                                | settled                                           |
| S8  | A full search results page, not only a hover — users may want to act on or download the whole result set.                                                                                                      | open                                              |

## R3 — the list

| #   | Ruling                                                                                                                                                           | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L1  | Sortable columns, the data being the columns. Sorting must actually work.                                                                                        | settled |
| L2  | Filter as well as sort, per column. The filter control belongs to the column it filters, and appears without reflowing the header.                               | settled |
| L3  | User-selectable columns, with a reset button.                                                                                                                    | settled |
| L4  | Resizable column widths; double-clicking the divider fits the column to its widest value.                                                                        | settled |
| L5  | "Date Modified", not "Modified". "Version", not "Ver.".                                                                                                          | settled |
| L6  | A file-type column, and an option to hide extensions from names.                                                                                                 | settled |
| L7  | No checkbox squares beside rows — rows select without them.                                                                                                      | settled |
| L8  | Multi-select: individual, range, and non-contiguous.                                                                                                             | settled |
| L9  | The select-all control is folded into the selection count, not a separate square.                                                                                | settled |
| L10 | The selection count and the clear action live in the footer beside the file count.                                                                               | settled |
| L11 | Pin files and folders to the top, with a pin icon from the icon pack, separated by a rule so pinned items sit above everything rather than above their own kind. | settled |
| L12 | Folders show aggregate size and aggregate safety for their contents.                                                                                             | settled |
| L13 | A folder's Date Modified is its most recent modification, not its file count.                                                                                    | settled |
| L14 | Author is the person's name. Never "You".                                                                                                                        | settled |
| L15 | Drag-and-drop upload works without a prose instruction line under the list.                                                                                      | settled |
| L16 | No keyboard-hint text at the bottom of the list.                                                                                                                 | settled |
| L17 | Folder names are disambiguated so two "New Folder"s cannot collide.                                                                                              | settled |

## R4 — actions

| #   | Ruling                                                                                                                                                   | Status                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A1  | Pin, rename, copy, download and delete are **right-click actions**. They are not buttons in a header bar and not buttons in the right sidebar.           | settled                                                                    |
| A2  | Download, Open in Editor and Save New Version are removed from the right sidebar. Access is by right-click only.                                         | open (R5)                                                                  |
| A3  | The right-click item is "Download". Not "Download (acknowledge first)" or similar — if an acknowledgement is needed, raise it **after** the click.       | open (R5)                                                                  |
| A4  | Actions are icons, not text labels, wherever they repeat per row.                                                                                        | settled                                                                    |
| A5  | Copy and cut. Plain copy — not "copy to another folder". Folders copy too.                                                                               | open — copy is still not built                                             |
| A6  | "New folder", not "New subfolder".                                                                                                                       | settled                                                                    |
| A7  | The New button is on the left. There is no second New button on the right.                                                                               | settled                                                                    |
| A8  | Upload opens a real file picker.                                                                                                                         | settled                                                                    |
| A9  | Renaming: when extensions are hidden, the rename field shows no extension. When they are shown, the selection covers the name only, never the extension. | **regressed** — still selects the extension and still shows it when hidden |
| A10 | Template picking must scale to hundreds of templates — a plain dropdown does not. Stubbed for now.                                                       | open                                                                       |
| A11 | Document type is a custom, firm-editable vocabulary, and there must be a way to set it.                                                                  | open                                                                       |

## R5 — the inspector, versions and safety

| #   | Ruling                                                                                                                                                     | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I1  | The inspector is tabbed: Preview, Details, Version History, Hashes, Safety. Hashes is its own tab, not part of Versions. Preview is separate from Details. | open   |
| I2  | The paste-a-hash field sits at the top of the Hashes tab and is collapsed until asked for.                                                                 | open   |
| I3  | Hashes are recomputed when the tab is opened, not recited from storage.                                                                                    | open   |
| I4  | Version rows do not reflow on hover; Open and Restore are icon buttons that are always present.                                                            | open   |
| I5  | Version timestamps include the time of day.                                                                                                                | open   |
| I6  | Show a diff between two versions.                                                                                                                          | open   |
| I7  | Safety is its own tab, because safety has a history.                                                                                                       | open   |
| I8  | In safety history, the engine version is its own labelled attribute on its own line, not inline prose.                                                     | open   |
| I9  | A signature match is its own line, and clicking it opens a library explaining the finding.                                                                 | open   |
| I10 | When claimed type and magic bytes disagree, say what the bytes actually read as.                                                                           | open   |
| I11 | Do not restate the same fact three ways (File Type / Claimed Type / Actual Content). Consolidate.                                                          | open   |
| I12 | Folders in the inspector show content statistics — counts by file type, number of folders — not an Open/Download/deletion-rules block.                     | open   |
| I13 | Drop the "Folder · Discovery" line; the breadcrumb already says it, and it is incomplete.                                                                  | open   |
| I14 | Left and right sidebar toggle buttons carry no shadow when active.                                                                                         | open   |
| I15 | Real file-type icons, from a public, commonly used icon set — not letter tiles we drew ourselves.                                                          | open   |
| I16 | `.docx` shows as "Word". `.doc` shows as the legacy name. They are different internals and must be told apart.                                             | open   |

## R6 — file analysis

| #   | Ruling                                                                                                                       | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| F1  | A file-analysis view listing every potential issue on the matter: safety findings, type mismatches, other errors.            | settled |
| F2  | Analysis must let you **act on** the files from there, not only reveal them in the list. Reveal stays as one of the actions. | open    |
| F3  | Analysis rows show location.                                                                                                 | open    |
| F4  | No keyboard-hint text at the bottom of the analysis view.                                                                    | open    |
| F5  | Drop the "Every open finding on this matter…" explanatory line.                                                              | open    |
| F6  | Drop "View every finding on this matter" from the file list.                                                                 | open    |

## R7 — product rulings with backend consequences

| #   | Ruling                                                                                                                                                                                                                    | Status                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| P1  | **A file the user uploads is always stored and committed** — a suspected security issue or a type mismatch never blocks the write. The user deals with the file afterwards. Refusing to save is the greater hazard.       | open — spec written, not built |
| P2  | Entry into archives, and extraction out of one into a matter.                                                                                                                                                             | open — spec written, not built |
| P3  | Deleted files restore somewhere sane when their original folder is gone.                                                                                                                                                  | open                           |
| P4  | A file-manager error must give a technical explanation, first steps (refresh, check connection), and a working report path through the standard in-house reporting pipeline. Retry and Report must actually do something. | open — both are inert          |
| P5  | The error view must scroll.                                                                                                                                                                                               | open                           |
| P6  | "Save new version" as currently shaped is not wanted — replacing a document by uploading a copy over it is too easy to get wrong. Research the right workflow before building anything here.                              | open — analysis owed           |
| P7  | Resolve the difference between "Open" and "Open in Editor", or drop one.                                                                                                                                                  | open                           |
| P8  | Concurrent authorship needs a rule for who is credited. Look at what Google Docs does.                                                                                                                                    | open                           |
| P9  | Version identifiers: `v1` is fine. The date-stamped idea (`26-08-01.01`) is not adopted.                                                                                                                                  | settled                        |
| P10 | Pinned ordering: alphabetical or user-arranged — undecided.                                                                                                                                                               | open — owner question          |
| P11 | Whether a folder's file count is presented alongside its size — undecided.                                                                                                                                                | open — owner question          |

## R8 — round six

| #   | Ruling                                                                                                                                                                       | Status                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| N14 | Left and right sidebar toggle buttons carry no dark shadow when active.                                                                                                      | settled               |
| N15 | Swap New and Search so New keeps its place and does not reflow when the search expands.                                                                                      | settled               |
| N16 | The `…` overflow button matches the styling of the buttons beside it.                                                                                                        | settled               |
| N17 | The matter status chip moves next to the matter number. The top right holds buttons only — nothing uninteractable.                                                           | settled               |
| N18 | The `…` menu carries "Download Full Matter".                                                                                                                                 | settled               |
| N19 | Drop the tree / breadcrumb / version-id mock state toggles from the artifact.                                                                                                | settled               |
| S9  | "Open full results" sits at the top of the dropdown, on the same line as the scope selector.                                                                                 | open                  |
| S10 | Remove "Download all matches" from the results page. Selecting all and downloading is the path.                                                                              | settled               |
| S11 | The results page looks and behaves like the other matter file pages, with full access to the same information.                                                               | open                  |
| S12 | The search field appears in the results page header where "Results for" is.                                                                                                  | open                  |
| S13 | Clicking the field opens the dropdown before anything is typed.                                                                                                              | open                  |
| S14 | **Defect:** an existing query does not re-run — a letter has to be added or removed to make it fire.                                                                         | open                  |
| L19 | Reserve themed scrollbar space on the right of the file list.                                                                                                                | settled               |
| L20 | The footer says "Select none", not "Clear".                                                                                                                                  | settled               |
| L21 | Remove the download-selection button from the footer; right-click carries it.                                                                                                | settled               |
| L22 | Clicking empty space in the list clears the selection.                                                                                                                       | settled               |
| L23 | Never "Just now" — always a timestamp.                                                                                                                                       | settled               |
| L24 | Files marked for copy or cut look different in the list.                                                                                                                     | settled               |
| L25 | Selecting must not reflow the footer.                                                                                                                                        | settled               |
| L26 | A view toggle between list and icons, with a picture-only folder in the fixture to show it.                                                                                  | settled               |
| L27 | Propose any missing columns.                                                                                                                                                 | settled               |
| T1  | "New folder" becomes a button beside the expand/collapse control in the left sidebar.                                                                                        | settled               |
| T2  | The left sidebar's heading is the root row itself, named **Home**, selectable to reach the root; the folder controls sit to its right. There is no separate "Folders" label. | settled               |
| T3  | The left sidebar's home icon matches the breadcrumb's.                                                                                                                       | settled               |
| T4  | Right-click works on left-sidebar folders.                                                                                                                                   | settled               |
| T5  | Folders recolour from a set palette: red, orange, yellow, green, blue, purple, black, white, brown, grey. Leave room for a future icon change.                               | settled               |
| I18 | The inspector has no horizontal scrollbar. If anything scrolls sideways it is the tab strip.                                                                                 | settled               |
| I19 | Remove "See the Safety tab for what was found."                                                                                                                              | settled               |
| I20 | Details says only that a safety issue exists and to open the Safety tab; the detail lives there.                                                                             | settled               |
| I21 | Drop the "Verified" marker beside the hashes.                                                                                                                                | settled               |
| I22 | A compare button sits beside the hash refresh button; the separate compare area at the top goes away.                                                                        | settled               |
| I23 | Safety's Engine line names the engine version, not just the engine.                                                                                                          | settled               |
| I24 | The signature sheet is unreadable — no background. Fix it.                                                                                                                   | settled               |
| I25 | Version comparison becomes a full modal for moving between versions, tied to the preview. Deferred, marked Soon.                                                             | open — deferred       |
| I26 | Remove "— bytes agree". Agreement is the assumption; only disagreement is stated.                                                                                            | settled               |
| I27 | **Regression:** document type can no longer be set.                                                                                                                          | settled               |
| P12 | Enter zip files from the list.                                                                                                                                               | settled               |
| P13 | File analysis gives more information and lets the files be acted on.                                                                                                         | open                  |
| P14 | Where does signature-library content come from? Is there a public source to tie to?                                                                                          | open — owner question |
| P15 | Is a quarantine view worth having for matter viewing?                                                                                                                        | open — owner question |

## Answers owed on the open questions

The three entries above marked _owner question_ asked for a recommendation rather than a guess.
Here is each, with what was actually checked.

### P14 — where the signature explanations come from, and whether a public source exists

**Today they come from nowhere.** The entries in the mockup's signature library are written by hand.
That is fine for a mockup and unacceptable shipped: a member reading "what this signature means"
would be reading our paraphrase of a detection we did not make.

**Two thirds of the answer is public, and the split matters.**

1. **The name is decodable, publicly and mechanically.** Cisco Talos publishes signatures as
   `{platform}.{category}.{name}-{signature id}-{revision}`, and both the platform list (Pdf, Doc,
   Html, Js, Heuristics, Archive, …) and the category list (Exploit, Ransomware, Downloader,
   Infostealer, Phishing, Macro, Packed, …) are enumerated in the ClamAV documentation. So
   `Pdf.Exploit.CVE_2026_1173` decodes without anyone's help: a PDF-targeting exploit signature.
   Rendering that decomposition is honest, costs one parser, and needs no external call.
2. **When the name embeds a CVE, that CVE is a citable authority.** MITRE assigns the identifier and
   NIST's National Vulnerability Database enriches it with a severity score, a weakness mapping and
   affected-product data, reachable through a documented public API. A finding naming a CVE can link
   to the public record for it instead of to our prose.
3. **There is no public per-signature description feed.** No authoritative source maps
   "Pdf.Exploit.CVE_2026_1173" to a paragraph. The signature database ships patterns, not
   explanations, and the naming document is a taxonomy, not a dictionary.

**Recommendation.** Build the panel out of (1) and (2) and drop our prose entirely. Show the decoded
platform and category from the name, and where a CVE is present, its title and severity from the
public record with a link. Where the name carries no CVE — heuristics especially — say plainly that
the detection is a heuristic and what the category means, and stop there. What we must not do is
keep a hand-written library that looks authoritative and is not; the honest failure is "this
signature is not in the firm library yet", which the mockup already renders.

### P15 — is a quarantine view worth having

**No, and it would contradict a ruling you have already made.** The standing position is that a file
the user uploads is always stored and committed, and that refusing to save is the greater hazard. A
quarantine is the opposite gesture: it moves a file out of where it was filed into a holding pen,
which is exactly the "the system took my document away" experience the ruling exists to prevent. It
would also break the matter record — a file that is evidence does not stop being evidence because an
engine disliked its bytes.

**What the request is actually reaching for already exists in two places.** The File Analysis view is
the list of everything with an open finding, and the Safety tab is the per-file history. Between them
a member can see every flagged file on the matter and act on each. Adding quarantine would give a
third place for the same facts and a fourth state for a file to be in.

**One narrow piece is worth taking from the idea:** a saved filter on the file list for "has an open
finding", so the flagged set is reachable from the list itself and not only from a separate view. The
filter machinery is already built — Safety is a filterable column — so this is a preset, not a
feature.

### L27 — the columns that are missing

Checked against the schema rather than invented.

1. **Uploaded by.** The strongest gap: `file_version.uploaded_by` has existed since baseline and is
   populated, and the list shows no author column at all. A ruling already settled that authorship
   reads as the person's name; there is currently nowhere for that name to appear. **Add it, on by
   default.**
2. **Location.** Derivable from the folder, useless in a folder listing and necessary in the results
   and analysis views. **Add it, off by default in browse, forced on in results and analysis.**
3. **Pages.** Litigation asks for page counts constantly. `page_count` exists — but on the discovery
   document table, recorded at extraction, not on the matter file. **Later**, when extraction writes
   back to the file record; not a column we can fill today.
4. **Bates / production number.** No column exists. The discovery schema's own comment says page
   count was recorded because "Bates numbering will need it", so the numbering is planned and not
   built. **Later**, and it belongs to the production slice, not to this screen.
5. **Searchable.** Whether the text index can see a file is a real operational fact — it separates
   "search found nothing" from "search cannot see this" — but no column on `file` carries it and the
   search subsystem would have to expose it. **Worth doing, needs a seam first.**

So: two now (Uploaded by, Location), three that want work elsewhere before they can be honest.
