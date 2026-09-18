# Matter file manager — the owner's standing rulings

Every ruling the owner has issued on this screen, cumulative, newest round last. **A ruling here is
settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round that
silently reverts one is a regression, not a redesign.

Read this file before changing the screen, and check the built screen against it after. Do not
rebuild the screen from scratch: edit it. Regeneration is what loses these.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

**Reconcile the statuses before reading them as work.** A status is a claim about the built screen,
and it goes stale the moment a round builds something without coming back to this table. Stale in
the `open` direction is as costly as stale in the `regressed` direction — it sends the next round to
rebuild what already exists, which is how a screen loses the thing it had. So the first step of any
round is `pnpm check:file-manager-rulings <path-or-url>`: what it asserts is the answer, and any row
it contradicts is corrected here in the same commit, before a line of the screen changes. Rows the
harness does not cover are checked by hand and get a check added when they are next built.

## R1 — shell and navigation

| #   | Ruling                                                                                                                            | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| N1  | The screen lives inside the existing app shell; it is not a full-page takeover.                                                   | settled |
| N2  | Selecting a file does **not** darken the screen. It behaves like the workbench, not a modal.                                      | settled |
| N3  | Back, forward and up buttons, all three, in the file-manager toolbar.                                                             | settled |
| N4  | The breadcrumb root is a **home icon**, not the word "Files".                                                                     | settled |
| N5  | Back/forward/up hovers say just "Back", "Forward", "Up" plus the shortcut. Not verbose.                                           | settled |
| N6  | Breadcrumbs use the compact spacing.                                                                                              | settled |
| N7  | The top header carries the breadcrumbs and the New button; the left sidebar starts beneath it.                                    | settled |
| N8  | Scrolling down reduces the top chrome to give the list more height.                                                               | settled |
| N9  | Carets in the left sidebar expand and collapse nesting.                                                                           | settled |
| N10 | No reflow in the left sidebar when a folder is selected.                                                                          | settled |
| N11 | Reserved, themed scrollbar space in the left sidebar; also on the right of the file list; the horizontal scrollbar is themed too. | settled |
| N12 | Right-click works in the left sidebar, not only in the list.                                                                      | settled |
| N13 | One button toggles expand-all / collapse-all, not two.                                                                            | settled |

## R2 — search

| #   | Ruling                                                                                                                                                                                                         | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| S1  | The matter search sits **next to the matter status chip** (e.g. "Open"), not in the app header and not in the file-manager toolbar. It searches the whole matter — billing and time included — not just files. | settled |
| S2  | It expands from an icon and collapses when unused.                                                                                                                                                             | settled |
| S3  | No `x` clear button in that field.                                                                                                                                                                             | settled |
| S4  | Scope is a dropdown, not oversized circular buttons; the dropdown aligns to the left edge of the field.                                                                                                        | settled |
| S5  | Search covers file **names and contents**.                                                                                                                                                                     | settled |
| S6  | Show search progress and status, not a prose explanation of how indexing works.                                                                                                                                | settled |
| S7  | A result names its full breadcrumb, not just the parent folder.                                                                                                                                                | settled |
| S8  | A full search results page, not only a hover — users may want to act on or download the whole result set.                                                                                                      | settled |

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

| #   | Ruling                                                                                                                                                   | Status                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A1  | Pin, rename, copy, download and delete are **right-click actions**. They are not buttons in a header bar and not buttons in the right sidebar.           | settled                                                               |
| A2  | Download, Open in Editor and Save New Version are removed from the right sidebar. Access is by right-click only.                                         | settled                                                               |
| A3  | The right-click item is "Download". Not "Download (acknowledge first)" or similar — if an acknowledgement is needed, raise it **after** the click.       | settled                                                               |
| A4  | Actions are icons, not text labels, wherever they repeat per row.                                                                                        | settled                                                               |
| A5  | Copy and cut. Plain copy — not "copy to another folder". Folders copy too.                                                                               | settled                                                               |
| A6  | "New folder", not "New subfolder".                                                                                                                       | settled                                                               |
| A7  | The New button is on the left. There is no second New button on the right.                                                                               | settled                                                               |
| A8  | Upload opens a real file picker.                                                                                                                         | superseded — A17: the Upload dialog opens first and holds the pickers |
| A9  | Renaming: when extensions are hidden, the rename field shows no extension. When they are shown, the selection covers the name only, never the extension. | settled                                                               |
| A10 | Template picking must scale to hundreds of templates — a plain dropdown does not. Stubbed for now.                                                       | open                                                                  |
| A11 | Document type is a custom, firm-editable vocabulary, and there must be a way to set it.                                                                  | settled                                                               |

## R5 — the inspector, versions and safety

| #   | Ruling                                                                                                                                                     | Status            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| I1  | The inspector is tabbed: Preview, Details, Version History, Hashes, Safety. Hashes is its own tab, not part of Versions. Preview is separate from Details. | settled           |
| I2  | The paste-a-hash field sits at the top of the Hashes tab and is collapsed until asked for.                                                                 | superseded by I22 |
| I3  | Hashes are recomputed when the tab is opened, not recited from storage.                                                                                    | settled           |
| I4  | Version rows do not reflow on hover; Open and Restore are icon buttons that are always present.                                                            | settled           |
| I5  | Version timestamps include the time of day.                                                                                                                | settled           |
| I6  | Show a diff between two versions.                                                                                                                          | settled           |
| I7  | Safety is its own tab, because safety has a history.                                                                                                       | settled           |
| I8  | In safety history, the engine version is its own labelled attribute on its own line, not inline prose.                                                     | settled           |
| I9  | A signature match is its own line, and clicking it opens a library explaining the finding.                                                                 | settled           |
| I10 | When claimed type and magic bytes disagree, say what the bytes actually read as.                                                                           | settled           |
| I11 | Do not restate the same fact three ways (File Type / Claimed Type / Actual Content). Consolidate.                                                          | settled           |
| I12 | Folders in the inspector show content statistics — counts by file type, number of folders — not an Open/Download/deletion-rules block.                     | settled           |
| I13 | Drop the "Folder · Discovery" line; the breadcrumb already says it, and it is incomplete.                                                                  | settled           |
| I14 | Left and right sidebar toggle buttons carry no shadow when active.                                                                                         | settled           |
| I15 | Real file-type icons, from a public, commonly used icon set — not letter tiles we drew ourselves.                                                          | open              |
| I16 | `.docx` shows as "Word". `.doc` shows as the legacy name. They are different internals and must be told apart.                                             | superseded by L32 |

## R6 — file analysis

| #   | Ruling                                                                                                                       | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| F1  | A file-analysis view listing every potential issue on the matter: safety findings, type mismatches, other errors.            | settled |
| F2  | Analysis must let you **act on** the files from there, not only reveal them in the list. Reveal stays as one of the actions. | settled |
| F3  | Analysis rows show location.                                                                                                 | settled |
| F4  | No keyboard-hint text at the bottom of the analysis view.                                                                    | settled |
| F5  | Drop the "Every open finding on this matter…" explanatory line.                                                              | settled |
| F6  | Drop "View every finding on this matter" from the file list.                                                                 | settled |

## R7 — product rulings with backend consequences

| #   | Ruling                                                                                                                                                                                                                    | Status                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| P1  | **A file the user uploads is always stored and committed** — a suspected security issue or a type mismatch never blocks the write. The user deals with the file afterwards. Refusing to save is the greater hazard.       | open — spec written, not built |
| P2  | Entry into archives, and extraction out of one into a matter.                                                                                                                                                             | open — spec written, not built |
| P3  | Deleted files restore somewhere sane when their original folder is gone.                                                                                                                                                  | settled — round ten (D2)       |
| P4  | A file-manager error must give a technical explanation, first steps (refresh, check connection), and a working report path through the standard in-house reporting pipeline. Retry and Report must actually do something. | settled                        |
| P5  | The error view must scroll.                                                                                                                                                                                               | settled                        |
| P6  | "Save new version" as currently shaped is not wanted — replacing a document by uploading a copy over it is too easy to get wrong. Research the right workflow before building anything here.                              | answered — awaiting decision   |
| P7  | Resolve the difference between "Open" and "Open in Editor", or drop one.                                                                                                                                                  | open                           |
| P8  | Concurrent authorship needs a rule for who is credited. Look at what Google Docs does.                                                                                                                                    | open                           |
| P9  | Version identifiers: `v1` is fine. The date-stamped idea (`26-08-01.01`) is not adopted.                                                                                                                                  | revised — round ten (I43)      |
| P10 | Pinned ordering: alphabetical or user-arranged — undecided.                                                                                                                                                               | settled                        |
| P11 | Whether a folder's file count is presented alongside its size — undecided.                                                                                                                                                | settled                        |

## R8 — round six

| #   | Ruling                                                                                                                                                                       | Status                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| N14 | Left and right sidebar toggle buttons carry no dark shadow when active.                                                                                                      | settled               |
| N15 | Swap New and Search so New keeps its place and does not reflow when the search expands.                                                                                      | settled               |
| N16 | The `…` overflow button matches the styling of the buttons beside it.                                                                                                        | settled               |
| N17 | The matter status chip moves next to the matter number. The top right holds buttons only — nothing uninteractable.                                                           | settled               |
| N18 | The `…` menu carries "Download Full Matter".                                                                                                                                 | settled               |
| N19 | Drop the tree / breadcrumb / version-id mock state toggles from the artifact.                                                                                                | settled               |
| S9  | "Open full results" sits at the top of the dropdown, on the same line as the scope selector.                                                                                 | settled               |
| S10 | Remove "Download all matches" from the results page. Selecting all and downloading is the path.                                                                              | settled               |
| S11 | The results page looks and behaves like the other matter file pages, with full access to the same information.                                                               | settled               |
| S12 | The search field appears in the results page header where "Results for" is.                                                                                                  | settled               |
| S13 | Clicking the field opens the dropdown before anything is typed.                                                                                                              | settled               |
| S14 | **Defect:** an existing query does not re-run — a letter has to be added or removed to make it fire.                                                                         | settled               |
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
| I20 | Details says only that a safety issue exists and to open the Safety tab; the detail lives there.                                                                             | superseded by I38     |
| I21 | Drop the "Verified" marker beside the hashes.                                                                                                                                | settled               |
| I22 | A compare button sits beside the hash refresh button; the separate compare area at the top goes away.                                                                        | settled               |
| I23 | Safety's Engine line names the engine version, not just the engine.                                                                                                          | settled               |
| I24 | The signature sheet is unreadable — no background. Fix it.                                                                                                                   | settled               |
| I25 | Version comparison becomes a full modal for moving between versions, tied to the preview. Deferred, marked Soon.                                                             | settled               |
| I26 | Remove "— bytes agree". Agreement is the assumption; only disagreement is stated.                                                                                            | settled               |
| I27 | **Regression:** document type can no longer be set.                                                                                                                          | settled               |
| P12 | Enter zip files from the list.                                                                                                                                               | settled               |
| P13 | File analysis gives more information and lets the files be acted on.                                                                                                         | settled               |
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

## R9 — round seven of review: the repeats, and the deletion model

The three at the top had each been raised more than once. Two of them were marked `settled` in this
very file while the screen still had the defect, because the harness asserted the wrong property.

| #    | Ruling                                                                                                                                                                       | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A9   | Renaming never selects the extension, and never shows it when extensions are hidden. Raised three times.                                                                     | settled |
| I14  | An active sidebar toggle shows no dark fill. The complaint was always the FILL; the check tested `box-shadow`, which was already `none`, so it passed while the fill stayed. | settled |
| A12  | Delete works. Files soft-delete. A folder with contents asks, defaulting to keeping them — the folder goes, its contents move up one level. Cascade is the second choice.    | settled |
| L28  | A folder row is exactly as tall as a file row. The row icon had no size class at all and rendered at 200px.                                                                  | settled |
| N20  | Home in the rail returns to the root. It had a contextmenu handler and no click handler.                                                                                     | settled |
| P11  | A folder's Size cell reads bytes AND count, e.g. "4.6 GB · 13 files".                                                                                                        | settled |
| P10  | Pinned ordering is user-arranged.                                                                                                                                            | settled |
| T6   | Colour is a submenu opening to the right, swatches are squares. The palette values are unchanged.                                                                            | settled |
| I27b | Document type is editable from the field in Details that displays it, not only from right-click.                                                                             | settled |
| I28  | A digest states itself. "matches ingest" is struck — a hash recomputed on open needs no provenance caption.                                                                  | settled |
| I29  | Safety history uses what the scanner declares ("No issues found"), never our own cheerful phrasing.                                                                          | settled |
| I30  | The inspector tab strip scrolls horizontally; it never wraps to a second row.                                                                                                | settled |
| I31  | The signature modal is rebuilt: header/body/footer, the signature name decoded into its four documented parts, an NVD link where the name embeds a CVE, and a source line.   | settled |
| I32  | A digest can be verified by choosing a file from disk; it is hashed in the browser and never uploaded.                                                                       | settled |
| F7   | A clean file gets no preamble explaining that it is clean.                                                                                                                   | settled |
| P5   | A dialog is capped at the viewport and only its body scrolls, so a long one cannot push its own Close button off-screen.                                                     | settled |
| P4   | The error view names the request, the status and the time, gives three first steps, and leads with the fact that the record is unaffected.                                   | settled |
| P4b  | Report a Problem opens a real reporter: what is sent is listed, a screenshot is opt-in, and it states that no document, file name or matter content leaves the firm.         | settled |
| P5b  | The error view is a PANE, not a dialog — it scrolls inside its own container. P5 had been marked settled off the dialog cap, which never applied here.                       | settled |
| P12c | Archive members render on the matter's own table — same columns, same row height. Columns an archive member cannot answer are EMPTY, never invented.                         | settled |
| I25  | Comparing versions is deferred. The affordance stays on every older row, disabled, and says it is not built.                                                                 | settled |

**Owner rulings recorded this round, binding from here:**

- **Nothing is ever blocked.** A flag is a note, not a gate. Users always reach their files. This
  makes `allow-and-flag` the only correct ingest treatment and turns the platform's existing
  `quarantined` path into something to remove rather than surface.
- **Folder deletion asks, and keeping the contents is the default.** An empty folder deletes with no
  dialog. Cascade exists but is never the accidental click.
- **Litigation holds are out of scope here.** The hold table covers custody packets, not matter
  files, and our delete is a soft delete that destroys nothing.

| #   | Still open                                                                                                                                                           | Status                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| I15 | Real file-type icons from a public set.                                                                                                                              | open — owner question        |
| P6  | "Save new version" — answered in [`docs/specs/2026-08-24-save-new-version-analysis.md`](../specs/2026-08-24-save-new-version-analysis.md); one owner question in it. | answered — awaiting decision |
| P7  | Open vs Open in Editor.                                                                                                                                              | settled — round ten (A24)    |
| P8  | Concurrent authorship credit.                                                                                                                                        | open                         |
| A10 | Template picking at scale.                                                                                                                                           | open — deferred              |

## R10 — round eight: the icons ruling, and the deleted list becoming a list

| #    | Ruling                                                                                                                                                                                   | Status  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| I15  | **We do not draw our own glyphs. Every icon is Lucide**, taken from the installed `@lucide/svelte` package rather than hand-authored path data. This binds the app, not just the mockup. | settled |
| T6b  | Colour and Icon are two separate right-click items, each with its own flyout. Icon is not reached by going through Colour.                                                               | settled |
| T6c  | The palette runs in rainbow order and includes pink. Swatches are true squares — no corner radius.                                                                                       | settled |
| I33  | A tab strip scrolls sideways only. It is tall enough for its own horizontal scrollbar, so no vertical one appears.                                                                       | settled |
| L29  | Both side panels resize by dragging their inner edge, identically. Arrow keys move them; a double-click restores the default.                                                            | settled |
| I27c | Document type is a dropdown anchored to whatever opened it, never a modal.                                                                                                               | settled |
| I34  | A scanner finding can be copied and downloaded, and both render from one text so they cannot disagree.                                                                                   | settled |
| F8   | File Analysis offers Copy All and Download All Issues.                                                                                                                                   | settled |
| I35  | A version label is one token: "v12" does not read as "v1 2". Tabular figures are off for version labels.                                                                                 | settled |
| N21  | A view that is not a place in the folder tree titles the breadcrumb rather than adding a heading beneath it.                                                                             | settled |
| F9   | Safety History in File Analysis opens the panel it points at. It set a tab on a panel the view had disabled, so it looked live and did nothing.                                          | settled |
| F10  | File Analysis counts by severity, not by how many files have anything at all.                                                                                                            | settled |
| F11  | An issue can be ignored, the ignored ones can be viewed, and any of them can be taken back. Ignoring is per issue, not per file.                                                         | settled |
| D1b  | Deleted files render on the matter's own table: same columns, same sorting, same right-click, same multiple selection — plus Deleted, Deleted By and Was In.                             | settled |
| D1c  | The deleted view's explanatory paragraphs are struck, and its row buttons are gone: Restore lives in the right-click menu, where it cannot overlap anything.                             | settled |
| A13  | One selection control, and it says what pressing it will do. Two buttons meant one of them was always the wrong one.                                                                     | settled |
| A14  | Unselecting a row reaches the details panel. It kept showing the file the user had just let go of.                                                                                       | settled |
| L30  | A column's filter control sits with that column's label and reserves its space at all times, so revealing it on hover moves nothing.                                                     | settled |
| L31  | The list runs to the edge of its column. A scrollbar gutter reserved on both edges held the table off and stopped its rules short.                                                       | settled |
| I36  | Scan provenance prose is struck; a finding states itself.                                                                                                                                | settled |

**Owner rulings recorded this round, binding from here:**

- **Lucide, always.** We do not draw glyphs. Where Lucide has no icon for a thing, the answer is the
  nearest Lucide icon, not a drawn one.
- **A checkout is not a lock.** Editing runs through Durable Objects, so other people can edit a
  checked-out file. This closes the question the save-new-version analysis raised.
- **Presence is worth having.** A document should be able to show that other people have it open.
  Recorded as P16; designed here, not built.

## R11 — round nine: the extension column, undo, and the History changelog

| #    | Ruling                                                                                                                                                                                                                                                                           | Status                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| I37  | The safety report's Copy and Download are small icon buttons, out of the reading's way. Refines I34: both still render from one text, so they cannot disagree.                                                                                                                   | settled                                                                                                                                           |
| I38  | Details carries NO safety sentence. An open finding is one row like every other — a Flag icon (Lucide Flag) whose click opens the Safety tab. All details rows read alike. **Supersedes I20.**                                                                                   | settled                                                                                                                                           |
| L32  | The File Type column always shows the extension — "mp4", "zip", "docx" — never the processing category. **Supersedes I16**: the extension tells `.doc` and `.docx` apart on its own. Archive members too.                                                                        | settled                                                                                                                                           |
| L33  | A zebra setting sits directly beneath the file-extension setting in the columns menu: alternating row shading, design tokens only, with selection and hover keeping the last word.                                                                                               | settled                                                                                                                                           |
| L34  | The per-column filter button sits inside the same header cell as the label it filters — one unit, one hover surface covering both. Refines L30: its space is still reserved, so revealing it moves nothing.                                                                      | settled                                                                                                                                           |
| L35  | A column can be pinned: it holds its place under horizontal scrolling (`position: sticky`), discoverable where column controls already live (the columns menu), shown with the Lucide pin.                                                                                       | settled                                                                                                                                           |
| L36  | Filtering works on every column through ONE mechanism parameterized per column type — a checkbox set, a contains-text field, or a from/to range — never per-column copies.                                                                                                       | settled                                                                                                                                           |
| L11b | **Regression:** the pin glyph carried Lucide `star` geometry, not the pin L11 ruled. Fixed: the pin is Lucide `pin` everywhere it appears — pinned rows and column pinning alike.                                                                                                | settled                                                                                                                                           |
| L14b | **Regression:** deleting a file at runtime recorded its deleter as "You", which the deleted list then displayed. Fixed: the deleted record carries the person's name and the file's real authorship.                                                                             | settled                                                                                                                                           |
| A15  | Undo and redo stacks for movement — moves between folders, drag-and-drop, cut/paste. Ctrl+Z / Ctrl+Y (and Shift+Ctrl+Z), plus visible controls beside Back/Forward/Up that say what will be undone.                                                                              | settled                                                                                                                                           |
| N22  | A History changelog in the left sidebar, directly beneath File Analysis and Deleted Files: how files moved, were renamed, deleted, or changed — on the matter's own table (D1b), the breadcrumb titling the view (N21), columns time · action · file · from → to · who.          | settled                                                                                                                                           |
| T7   | Folders can be moved by dragging within the left-sidebar tree. A folder never drops into itself or its own descendants; the move is undoable like any other.                                                                                                                     | settled                                                                                                                                           |
| A16  | Uploading opens a destination modal: the currently viewed folder (default), the root, or any other folder through a folder picker. A8's real file picker still applies — the modal follows the pick. Save New Version asks nothing: its destination is the file it was asked on. | superseded — A17: the modal comes first and nothing is sent until Upload is pressed; the three destinations and the Save New Version clause stand |
| I39  | Clicking the file name in the inspector renames it inline. A9 binds: the extension is never selected, and never shown while extensions are hidden.                                                                                                                               | settled                                                                                                                                           |
| L37  | An unset document type shows BLANK — never "Unfiled" — in the cell and in the Details field alike. The field keeps its labelled, clickable footprint.                                                                                                                            | settled                                                                                                                                           |
| I40  | The preview box fits its panel — the tall preview's fixed height had made its aspect ratio force the width past the screen edge. And an image file previews AS the image in the Preview tab, not as a page placeholder.                                                          | settled                                                                                                                                           |

**Notes recorded this round:**

- I38 removes the finding sentence from Details; the byte-disagreement statement stays there
  because it is a TYPE fact — I10 ("say what the bytes actually read as") still binds.
- The document-type menu's "Add" item rendered the literal text "undefined" — `ICONS.plus` was
  referenced but never defined. Fixed in passing; no ruling needed, it was simply broken.

## R13 — round ten: thirty-four corrections in one sitting

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| L38  | A pinned item's pin renders FILLED wherever the pin state shows — the menu item, the row mark, the column-pin control. Same Lucide geometry; fill is the only difference.                                                                                                                                                                                                                                                                                                                                                                              | settled                                            |
| A17  | Pinning does NOT close the menu that caused it: the item toggles in place (label and filled glyph), because pinning is applied to several rows in a row.                                                                                                                                                                                                                                                                                                                                                                                               | settled                                            |
| L39  | A Scale control sits in the footer: a labelled, keyboard-operable slider (75–175%) scaling icon-view previews, list row height, row icons, and the file area's text.                                                                                                                                                                                                                                                                                                                                                                                   | superseded by L39b                                 |
| L40  | A computing aggregate renders its field IMMEDIATELY — visibly pending, never hidden — and fills in as values arrive, one folder at a time. Refines L12; folder rows now carry an aggregate safety chip too.                                                                                                                                                                                                                                                                                                                                            | settled                                            |
| A18  | Files get a Convert flyout: quick converts per source kind plus "Convert With Options" — every entry Soon-disabled with its reason (the conversion engine). Kinds with no honest convert get no item.                                                                                                                                                                                                                                                                                                                                                  | settled                                            |
| A15b | Undo and redo live in the FOOTER, away from Back/Forward/Up. Shortcuts unchanged. (The owner relocating round nine's A15 placement, not a regression.)                                                                                                                                                                                                                                                                                                                                                                                                 | settled                                            |
| I41  | The placeholder tail ": details, safety history, and versions live here while the list stays in reach." is struck. "Select a file or folder." stands alone.                                                                                                                                                                                                                                                                                                                                                                                            | settled                                            |
| L41  | Right-clicking the empty space beneath the rows opens the folder-level menu — New Folder, New Document, Upload, Paste, Select All — clearing the selection first (L22).                                                                                                                                                                                                                                                                                                                                                                                | settled                                            |
| A19  | **Defect root-caused:** the menu advertised Ctrl C/X/V but no keyboard handler existed. Wired into the one keydown listener; Ctrl+C yields to a real text selection; paste acts where the menu's Paste acts.                                                                                                                                                                                                                                                                                                                                           | settled                                            |
| N23  | The "Views" heading is removed — T2's precedent: the rows are self-describing and the separator rule stays. No replacement name earned its place.                                                                                                                                                                                                                                                                                                                                                                                                      | settled                                            |
| A20  | A multi-selection menu speaks for the WHOLE selection. Recorded per action: Download/Copy/Cut/Pin/Delete/Re-run carry counts; Set Document Type scopes to the files; Colour/Icon scope to the folders (shared marks only when all agree); Open and Rename disabled with reasons (one-item gestures); Convert and Browse Inside omitted on multi; Delete disabled with reason when a non-empty folder is included; deleted-view Details disabled with reason on many; archive members carry the extraction menu.                                        | settled                                            |
| T6e  | **Defect root-caused:** a hovered swatch turned white — the menu's generic hover wash outranked the swatch's background. A swatch hover keeps ITS COLOUR; the outline is the affordance.                                                                                                                                                                                                                                                                                                                                                               | settled                                            |
| T6f  | The selected swatch's halo paints ABOVE its neighbours (raised stacking), never overpainted. T6c re-verified square as rendered: computed radius 0 — no regression found this round.                                                                                                                                                                                                                                                                                                                                                                   | superseded by T6h — round thirteen                 |
| A21  | **Defect root-caused:** renaming `.pdf.exe` to `.pdf` bounced — the commit re-appended the protected extension over a deliberate edit. A9 clarified: it governs selection and display, never editability. Extensions SHOWN: what was typed stands (the extension column follows; the bytes' finding does not). Extensions HIDDEN: the stored extension reattaches — extension edits are made with extensions shown. Authoritative for the app's rename too, per the owner.                                                                             | settled                                            |
| A22  | The folder-delete dialog: header fixed (**defect:** the `h2` sat outside any `header`, so the header padding rule never applied — same unclosed-header defect fixed in Restore and the acknowledgement dialog); WHICH files are affected is a collapsible list behind an honest count; options are keep-structure (default) / drop-the-structure (when subfolders exist) / cascade last; destination is up-one-level (default) / root / any folder via the shared A16 picker, which excludes the deleted subtree. Empty folders still delete silently. | settled                                            |
| N22b | History rows lead to their documents: click reveals (browse selection + inspector, or Deleted Files for deleted items); right-click carries the actions that still apply, scoped to where the document is NOW (refs resolved at click time). Bulk operations write one row per document, so every affected document is reachable. Rows whose document is gone say so and offer nothing dead.                                                                                                                                                           | superseded by N22c                                 |
| S15  | **Defect root-caused:** "Open full results" overflowed the dropdown — its bottom-of-panel styling (full width, top border) survived S9's move onto the scope line. It now fits the line; "Search in" renders on ONE line; the panel is 380px.                                                                                                                                                                                                                                                                                                          | settled                                            |
| S16  | The index status is WIRED: one ticking source feeds the dropdown label, its progress bar, and the results-page note; completion states itself instead of freezing at a stale percentage.                                                                                                                                                                                                                                                                                                                                                               | settled                                            |
| S18  | No scope says "Everywhere": this control searches the matter and no wider (S1) — application-wide search is the top bar's job. The vocabulary is "Everything on this matter / Files only / This folder".                                                                                                                                                                                                                                                                                                                                               | settled                                            |
| S17  | Search Results joins the views family: a rail row that appears while a search is live (an always-on empty row would be inert), marked current while open, breadcrumb titling the view (N21). Judgment recorded for correction.                                                                                                                                                                                                                                                                                                                         | superseded by S17b                                 |
| N24  | Rail spacing tightened: top padding and railhead at space-4, separator margins space-4 — the gap above Home and above the views group sits on the token rhythm, measured as rendered.                                                                                                                                                                                                                                                                                                                                                                  | settled                                            |
| L42  | A live filter is unmissable: the filtered column's funnel fills (accent-subtle), every view's footer counts "x of y · filtered", a one-click "Clear N Filters" sits in the footer, and a filtered-empty list says WHY with the clear affordance in place.                                                                                                                                                                                                                                                                                              | settled                                            |
| A24  | **P7 settled:** one "Open". Word-processing formats open the editor (a checkout is not a lock); everything else opens its Preview; a flagged file previews the withholding. The old "Open in Editor" item was ALSO inert — it had no handler. Double-click and Enter are the same gesture.                                                                                                                                                                                                                                                             | settled                                            |
| D2   | **P3 settled:** restoring a file whose folder is gone ASKS at restore time — the A16-shaped picker, defaulting to the nearest surviving ancestor of the old path. Intact restores stay silent. A multi-restore asks ONCE: intact files go straight home; all orphans land together at the one chosen place (recorded). The x:902 fixture path was corrected to be genuinely orphaned.                                                                                                                                                                  | revised — round thirteen (D2b: every restore asks) |
| F12  | Analysis severity vocabulary is Error / Warning / Info (Error = signature match, type mismatch; Warning = never scanned, no committed version; Info = no document type). The count chips ARE the band filters — click a count to narrow, item-19 active state — and the kind pills (P13) stay, properly spaced.                                                                                                                                                                                                                                        | settled                                            |
| I42  | The clean verdict is the Lucide circle-check: circle filled with the success token, white check. Applied to the Safety column and folder aggregates. Folding the state into the file icon itself is recorded as P17, an owner question — not built.                                                                                                                                                                                                                                                                                                    | settled                                            |
| A23  | **Defect:** Ctrl+A selected the page's text. It now selects every item on the VISIBLE surface (list rows or icon tiles); text fields keep native select-all.                                                                                                                                                                                                                                                                                                                                                                                           | settled                                            |
| L43  | Arrow keys in both layouts: the icon grid is 2D (Left/Right step, Up/Down move by visual row); the list has no horizontal axis, so Left/Right also move down/up — never dead keys. Shift+arrow extends the range from the anchor (L8).                                                                                                                                                                                                                                                                                                                 | settled                                            |
| I27d | **Defect root-caused:** Set Document Type opened at the far LEFT of the screen — the menu hid itself before the anchored dropdown measured its anchor, so the rect was zeros. It is now a flyout beside its menu item (the T6b pattern), filter-and-add inside (A11), capped and scrollable. Refines I27c's application in the menu; the Details-field dropdown (I27b) stays as is.                                                                                                                                                                    | settled                                            |
| A25  | Cut, Copy, Paste are their own menu group, bounded by the menu's separator rule, in every menu that carries them.                                                                                                                                                                                                                                                                                                                                                                                                                                      | settled                                            |
| F13  | The safety check can be RE-RUN: from the Safety tab, the right-click menu (counts on multi), and File Analysis rows. Append-only history — the request lands, then the scanner's words (I29, engine version per I23); a flagged file stays flagged; the oversize archive honestly stays unscanned; nothing is blocked. File-scoped by choice: a folder re-scan is recorded as a deliberate non-offer, not half-built recursion. The server pipeline exists, so nothing here needed a Soon.                                                             | settled                                            |
| N25  | The breadcrumb Home button's hover box matches the toolbar buttons exactly: 30×30, same radius, same hover surface.                                                                                                                                                                                                                                                                                                                                                                                                                                    | settled                                            |
| I43  | Versions are bare numbers — "12", never "v12" — in the Version column, version rows, tooltips, dialogs, and History's from/to. **Revises P9.** Where a bare number would dangle in prose, it reads "version 12". Scanner declarations in the safety history keep the scanner's own words (I29).                                                                                                                                                                                                                                                        | settled                                            |
| L44  | A clear-filter affordance exists ONLY while a filter is in play — absence is the signal (recorded choice over disabling). The per-column menu's clear button appears the moment that column's filter engages and vanishes when it clears; the footer control was already presence-only.                                                                                                                                                                                                                                                                | settled                                            |
| A26  | "Share" joins the file menu, Soon-disabled with its honest dependency: client-portal document sharing, which the build register carries as not started. Lucide share icon; multi-select composes ("Share 3 Files", still Soon).                                                                                                                                                                                                                                                                                                                        | settled                                            |
| I44  | Timestamps render in the viewer's LOCAL time on every surface — History, Date Modified/Created/Deleted columns, version and safety histories, digest messages. Stored instants are UTC; the fixture's written-out stamps are parsed deterministically and formatted at render, exactly as the app will treat real data.                                                                                                                                                                                                                                | settled                                            |

**Owner questions opened this round:**

- **P17** — fold the safety state into the file icon itself (a corner badge on `FileIcon`) instead
  of a separate column glyph? The filled circle-check ships now; this is the owner's floated
  alternative, recorded rather than guessed at.

**Notes recorded this round:**

- L32 was **incompletely applied** in round nine (not a regression): the folder statistics block,
  the analysis row line, and the version-diff sentence still spoke the category vocabulary. Swept
  onto extensions this round. The Details tab's "Type" row deliberately keeps the friendly reading
  with the exact-media-type disclosure — that is I10/I11 territory, recorded here so the owner can
  correct it if the extension is wanted there too.
- Clipboard marks (L24) now render inline with the rows, so a background re-render (the L40
  aggregate fill) can no longer wipe the cut/copy marking — found while wiring A19.
- The multi-restore choice (D2): one dialog, one destination for every orphaned file in the batch;
  the dialog says intact files go straight home.
- Runtime folder creation recorded the wrong disambiguated name in History (computed twice);
  computed once now — found while wiring N22b refs.
- A disabled Paste now states its reason ("Nothing is on the clipboard yet") in every menu — the
  A20 harness check caught it as the one disabled control without one.
- An aggregate value landing for a folder that is no longer on screen no longer re-renders: the
  background redraw was restarting the inspector's hash recompute (I3) and would have eaten an
  open rename. Ready values simply show on the folder's next render.
- The hidden table now empties when the icon grid or an empty state takes over. Stale rows in a
  hidden pane misled Ctrl+A (A23) and two harness reads in one round; a hidden surface holding
  yesterday's rows is a lie waiting for a reader.

## R14 — round eleven: the history panel, names that cannot collide, and the hashing stance

The owner's words this round: "the file manager area is really good."

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L39b | The Scale control carries no visible text label — the meaning is implied; the name lives in the hover tooltip and stays on the accessible name for keyboard and screen readers. Range widened to 50–200%. Everything else of L39 stands. **Supersedes L39** (the owner revising the label and range, not a regression).                                                                                                                                                                                                                                                     | settled |
| N22c | Selecting a history row PRESENTS the event in the details panel — what happened, when, who, from → to, and the document it concerns — and keeps the reader in the History list. The explicit gestures navigate: Reveal (in the panel's entry view and the right-click menu), the deleted-item path, and double-click. **Supersedes N22b.**                                                                                                                                                                                                                                  | settled |
| L45  | A name is born or changed in four places and all obey one rule — files with the same discipline as folders (refines L17): creation auto-disambiguates ("New Folder (2)"); a DELIBERATE rename that would collide is refused with inline validation naming the exact sibling it collides with — never a silent failure, never an auto-mangle; paste/copy disambiguates the copy; an upload into a collision disambiguates per the copy convention (version-vs-rename is the open P6 question, and this choice is recorded as touching it). Names compare case-insensitively. | settled |
| I45  | The Hashes tab shows every algorithm row BEFORE computation — value pending, filling as each digest lands (the L40 show-while-computing pattern). "Sets expectation, doesn't cause the user to feel surprise" — the owner. I3 (recompute on open) unchanged.                                                                                                                                                                                                                                                                                                                | settled |
| I46  | **Owner-ratified:** every version is hashable. The Hashes tab scopes to whichever version is being inspected — the scope is picked from the field that displays it (I27b's pattern), and every Version History row carries a verify affordance. Recomputed on open per I3, pending rows per I45.                                                                                                                                                                                                                                                                            | settled |
| I47  | **Owner-ratified:** the stored ingest digest is the tamper check. A recompute matching the record is SILENT (I28 holds — no caption); a difference is an unmistakable integrity warning naming both values, because for a matter record that difference is a chain-of-custody event. Fixture: Motion to Compel version 3 deliberately mismatches to show the alarm.                                                                                                                                                                                                         | settled |
| I48  | **Owner-ratified:** a version with no recorded ingest digest (an older ingest path) shows the recomputed values with an honest note that there is nothing to compare against — never fake agreement. Fixture: Motion to Compel version 1.                                                                                                                                                                                                                                                                                                                                   | settled |

**Notes recorded this round:**

- N22c keeps I17's discipline: selecting a history row updates what the panel WOULD show; the
  panel itself opens only by its own button, and follows along while open. Double-click is
  recorded as one of the explicit navigate gestures alongside Reveal.
- Moving a file into a folder that already holds its name is NOT covered by L45 — a move is
  neither a birth nor a deliberate rename, and mangling a name mid-move would surprise. Recorded
  as an open edge for the app build rather than half-decided here.
- The hash-scope field leaves room for the version-scoped reading the hashing recommendation
  asks about; the tab sits beside Version History and reads any version. Nothing beyond the
  mockup's share of the ratified stance was built.

## R15 — round twelve: the History columns, type identity, and the severity vocabulary

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| N26  | History's movement reads as TWO columns — "From" and "To" — each sortable and filterable like any column (through L36's one mechanism), never a combined "from → to" cell. The details-panel presentation (N22c) keeps its own composition. Refines N22's column list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | settled                         |
| N27  | History's actor column is titled **"Source"**. Reasoning recorded: the fixture already carries a non-person actor (the Court), and system-caused rows are coming (automatic re-scans; the retention stream), so "Person" would turn false the first time the platform acts on its own — "Source" is true for every row, person or platform. The N22c panel's row reads "Source" too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | settled                         |
| A27  | Right-click carries a quick filter scoping the current view to that document — offered where it earns its place: **History** ("Filter to This Document" — every event for the document, dead rows included) and **Search Results** ("Filter to This File"). Browse, Deleted Files and File Analysis deliberately do not offer it: narrowing a folder listing to one already-found row is noise. It IS a column filter, so L42's active-filter visibility and L44's presence-only clear affordance compose unchanged.                                                                                                                                                                                                                                                                                                                                                           | settled                         |
| L46  | "Date Created", never "Created" — the column header and the Details row alike (L5's own convention; "Date Modified" already ruled).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | settled                         |
| I49  | The Hashes tab verifies **all versions** on demand: a Verify All affordance runs the recompute-vs-record check across every version and presents a per-version result list — agreement rows compact (a quiet check mark, nothing more), a mismatch rendering I47's full alarm naming both values, a missing record rendering I48's honest note. Per-version inspection (I46) stays. The affordance appears when a file has more than one version; on a single-version file the scoped check already IS the whole answer.                                                                                                                                                                                                                                                                                                                                                       | settled                         |
| I50  | **Type identity within Lucide** (I15 stands — no drawn glyphs). Root cause of "a red file with a T": the pdf icon carried Lucide `file-type`, whose glyph is a letter T. The mapping now: pdf → Lucide `file` + "PDF" badge (red); docx → `file-text` + extension badge (blue); legacy doc → `file-text` + "DOC" badge (blue); xlsx → `file-spreadsheet` + extension badge (green); image → `file-image`; video → `file-video-2`; audio → `file-audio-2`; archive → `file-archive`; program → `file-cog` (red). Badges are REAL TEXT, never drawn glyphs, and ride the icon at every size. Partially answers the owner's per-type-icon expectation while honoring Lucide-only.                                                                                                                                                                                                 | settled                         |
| L32b | **Defect:** the Convert flyout spoke category names — "Plain Text", "Word (.docx)" — another L32 missed surface. Conversion targets now read as extensions ("To txt", "To docx", "To png"); where one extension covers two honest targets, the qualifier rides in parentheses ("To pdf (PDF/A, archival)", "To mp4 (web)"). The L32 harness sweep now covers the menu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | settled                         |
| L47  | The Safety cell's text is the **severity word in F12's vocabulary** — a flagged file reads "Error", a never-scanned file "Warning" — never the type-of-detail wording ("Type Mismatch", "Not Scanned"). Glyphs unchanged: clean stays the bare I42 circle-check with no text, chips keep the Lucide shield. A still-processing file keeps "Processing" — it has no verdict to grade yet. Chip tones follow the severity (Error = danger, Warning = warn).                                                                                                                                                                                                                                                                                                                                                                                                                      | revised — round thirteen (L47b) |
| L48  | The column is **"Created By"**, never "Uploaded By" — an upload counts as an act of creation. Swept everywhere the label appears (browse, deleted, results, the columns menu). L14 stands: always the person's name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | settled                         |
| A28  | **Defect:** New Folder pressed while in File Analysis landed in the previously open browse folder. Destination-scoped actions — New Folder, New Document, Upload, Paste, anything that writes into "the current folder" — exist only where a current folder genuinely exists: the browse views. In File Analysis, Deleted Files, History, Search Results and inside an archive, the New button and the rail's new-folder button render disabled with the reason, and the keyboard paste is a no-op; the empty-space menu (L41) was already browse-only. Every path audited: the New menu, the rail button, Ctrl+V, L41's menu, the row menus' Paste (disabled with the reason on a file row outside browse; a folder row is its own explicit destination and stays live), and drag-drop (which only ever targets an explicit folder, so it needed no change).                  | settled                         |
| T8   | The columns menu carries a sidebar display setting — **"Show File Counts in the Sidebar"** — hiding or showing the per-folder counts on the tree rows. It sits directly beneath the zebra entry (the same display-settings family as extensions and zebra), defaults to shown, and persists exactly as the other column-menu choices do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | settled                         |
| L34b | The per-column filter button is the header cell's **right edge** — label flush left, filter flush right, never "a strange distance in the middle" after the label. Refines L34: still one hover unit spanning the whole cell, and the space stays reserved so nothing reflows (L30). Applies in every table view. Right-aligned numeric columns already ended at the filter, so only the left-aligned composition changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | settled                         |
| N28  | **History is child-aware.** A folder act that carried files (a move; a rename) stays ONE row — never a synthetic row per file — and the row states its impact in-line ("moved with 8 files"), expandable to the affected list (the A22 collapsible-count treatment), each entry naming the file's own path change and revealing its document. The N22c panel presents the same fold. A document's single-file filter (A27) includes the events it inherited, rendered DISTINCTLY quieter ("Moved with its folder"), From/To showing the file's own resulting path — its story complete without pretending anyone acted on it directly. The owner's overload caution is the shape's whole reason: one row, impact behind a count. Fixture: Site Photographs moved Home → Discovery carrying its eight photographs; runtime folder moves and renames record impact the same way. | settled                         |
| S17b | Search Results **always** sits in the rail's views group — the owner: multiple ways to reach it. Clicking it with no live search opens the results view in its ready empty state, the S12 header field focused — never a dead click. Active-state highlighting as the other views. **Supersedes S17's** appears-while-live choice (the inert-empty-row worry S17 recorded is answered by making the empty click DO something: focus the field).                                                                                                                                                                                                                                                                                                                                                                                                                                | settled                         |
| S19  | The matter search takes an **"Include deleted files"** scope option in the dropdown's scope area, off by default. When on, deleted matches join the results MARKED as deleted (the Deleted Files view's own word, on a quieter row) and carry the deleted file's own right-click and details — Restore and Deleted Files, never a pretend live file. Architecture direction recorded pending owner ratification: implemented at the index as tag-and-filter — deleted documents stay in the matter's search index carrying a deleted facet, excluded by default at query time — rather than removal-on-delete.                                                                                                                                                                                                                                                                 | settled                         |
| F14  | File Analysis right-click ignores **in bulk**: Ignore All (N), and per-severity variants in F12's settled vocabulary — "Ignore N Error Issues / N Warning Issues / N Info Issues" — plus, on a card, that file's own issues first. Counts are honest and scoped to what the view currently shows (the open/ignored choice and any active band or kind filter respected); a severity with nothing present is ABSENT, not a dead item. Underneath, F11's per-issue model holds: bulk is many per-issue judgements, each still individually reversible, and the ignored view unignores in bulk the same way. The F12 severity chips follow every change.                                                                                                                                                                                                                          | settled                         |

**Notes recorded this round:**

- Two research streams spawned separately this round — deleted-files retention design, and
  open-file presence (P16). Nothing beyond what already exists was built for either here; their
  outcomes arrive as future rounds.
- A27's filter now follows the document's REFERENCE, not its spelling (upgraded with N28):
  rows written under a former name and folder acts that carried the document implicitly both
  land in the narrowed set. The earlier name-only limit note is obsolete. It remains one
  column-filter mechanism (L36), parameterized as a document filter.
- L47 keeps the folder aggregate chips' own wording ("Finding Beneath", "Not All Scanned") —
  they aggregate what is beneath rather than grade one file, and the owner named the file cell.
- I50's audio mapping (`file-audio-2`) is recorded ahead of any audio file in the fixture; the
  archive fixture's `measurements.xlsx` member is where the spreadsheet identity shows today.
- A28's recorded calls: **Search Results is not a destination** — its rows live in many folders,
  so "the folder you are looking at now" would name a folder the view never shows. **Inside an
  archive is not one either** (the paste guard already knew; New now agrees). And
  **disabled-with-reason was chosen over absent** for the New button and the rail's new-folder
  button — absent would reflow the header N15 protects; the New menu's items never render there
  because the gated button never opens it, which is the "absent is right for menu items" half.
- T8's counts stay computed while hidden (`subtreeFiles` still runs); the setting is a display
  choice, not a data one, so turning it back on costs nothing and shows current numbers.
- N28's scope, recorded honestly: folder MOVES and RENAMES carry impact. A folder DELETE keeps
  its existing recording — the delete dialog already lists the affected files before the act,
  and each deleted file writes its own row whose reference genuinely resolves into Deleted
  Files. Whether deletes should fold into the one-row-with-impact shape too is left for the
  owner's next round rather than half-decided here.
- S19's fixture path: the mockup's search matches names, so the deleted archive
  `Old Site Photos Batch 1.zip` surfaces under "Site"; content search joins as the text index
  fills (S5/S16 unchanged).
- **Defect found by the F14 harness check, fixed in passing:** outside browse, the keyboard
  handler returned before its Escape branch, so Escape could not close an open menu in File
  Analysis, History, Deleted Files or Search Results — it only closed by clicking elsewhere.
  Escape now closes menus in every view; the other list keys stay browse-only as before.

## R16 — round thirteen: the safety vocabulary completed, the results header, and restores that ask

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| L47b | The Safety column's value set is exactly **Error / Warning / Info / "Not scanned"** — the severity word plus the settled glyphs, nothing else in the cell. "Not scanned" is the unscanned file's own word (never "Warning"); a still-processing upload reads Warning (it has no committed version, and "Processing" was outside the set); a clean file with no document type reads Info; a clean, typed file keeps the bare I42 circle-check. Folder aggregates speak the SAME words — "Finding Beneath" and "Not All Scanned" are struck, overturning round twelve's note that the aggregate chips kept their own wording. **Supersedes L47's word set**; F12's analysis vocabulary itself is unchanged.                                      | settled                                   |
| S20  | The results header is the view's HEADER: one left-aligned row in the archive-bar family — the search glyph, the field (S12 stands: it lives where "Results for" was; the caps label is gone, the breadcrumb already titles the view per N21), the match count beside it, the index status pulled to the right edge. **Root cause found:** the header rendered into the state pane, which sits BELOW the table in the DOM, so the field floated "in the middle of the page" underneath however many rows the search returned. A dedicated `#viewbar` slot now sits ABOVE the table — and the archive bar, which had the same defect, moved into it too.                                                                                         | settled                                   |
| D2b  | **Every** restore asks, in what manner: **the original location** when it survives / **the nearest surviving ancestor** when it is gone (the default is whichever is true, named in the option) / **choose a folder** — Home is the picker's first row, so the old separate top-level radio folded into it — plus a **"Follow the restore to its new location"** checkbox that opens the landing folder with the file selected and revealed. A batch asks ONCE: intact files go straight home, orphans land together at the ancestor, and "choose a folder" gathers the whole batch at the one pick; follow goes to the FIRST restored file. **Revises D2's** silent intact restore; D2's picker shape and multi-restore rule otherwise stand. | settled                                   |
| P12d | A deleted zip is browsable from Deleted Files **without being restored** — "Browse Inside" on its right-click and double-click, P12's archive machinery reading the deleted copy, the archive bar naming its Deleted state. Extends P12; the search-results deleted rows (S19) reach the same menu.                                                                                                                                                                                                                                                                                                                                                                                                                                            | settled                                   |
| D3   | **Restoring from inside a deleted archive is an EXTRACTION into the live matter:** the member is copied out, committed and scanned like any upload, and recorded in History — the zip itself stays deleted. The member's right-click carries "Restore This File Into the Matter…" (a live archive's member reads "Extract"), opening the D2b-shaped destination modal: nearest surviving ancestor of the archive's old path as the default, any folder via the picker, the follow checkbox. The write itself is Soon-disabled naming the archive-extraction engine — P2's dependency, honestly stated.                                                                                                                                         | settled — designed; the write waits on P2 |
| T6g  | Every surface that renders a colour is a **true square, measured as rendered** — including the menu label's own pip, which is where the rounding the owner kept seeing actually lived: the checks measured the flyout's swatches (already radius 0) while the `swpip` beside the "Color" label carried radius-sm.                                                                                                                                                                                                                                                                                                                                                                                                                              | settled                                   |
| T6h  | The selected colour is an **inset Lucide check in a contrasting ink** (dark on yellow and white, light on the rest), rendered INSIDE the swatch. Researched before building: the checkmark-inside-the-swatch pattern is what the established pickers use (Google Docs/Slides colour grids; Material's checkbox model layers a contrast-tinted check on the filled square) precisely because an indicator that never leaves the box cannot overlap its neighbours. **Supersedes T6f's** raised halo. T6e's hover outline stays — hover is transient and under the pointer.                                                                                                                                                                      | settled                                   |
| N29  | **The owner's cross-surface ruling, applied here:** selecting an item NEVER opens a closed details panel. While the panel is open, selection updates what it presents (A14 applies only then); when the owner has closed it, clicking a row only selects — the panel opens by its explicit toggle, or by an explicit ask for its content (Details, Safety History, Open-as-preview, Reveal). The open/closed choice **persists** across visits.                                                                                                                                                                                                                                                                                                | settled                                   |

**Notes recorded this round:**

- L47b's Info band shows wherever a clean file has no document type — the deleted archive
  (x:902) is the fixture's example. Aggregate worst-word order: Error, Warning, Not
  scanned, Info (the middle two share F12's Warning band; the order follows the
  file-state ranking).
- D2b recorded calls: one "back where it was" radio covers original-or-ancestor per file
  ("Where each file was" on a batch); the follow choice is remembered for the session;
  History's deleted-row Restore item keeps its existing Soon (recovery endpoint) and was
  not touched this round.
- D3's member modal exists for live archives too ("Extract This File Into the Matter…",
  defaulting to the archive's own folder) — P2 remains the engine dependency for both,
  and "Extract Everything" keeps the whole-archive dialog.
- N29's persistence uses browser storage with a guarded read, so a context without
  storage still gets the in-session behaviour; the app build persists it as a real
  preference.

## R17 — round fourteen: the New control moves up to the matter header

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| N30 | **The New control is the matter header's, not the toolbar's.** The owner's 2026-09-03 ruling puts one create control beside the matter's search, at one width on every section, reading "New File" here and opening the same three-item menu the toolbar's New carried (New Document, New Folder, Upload Files). The toolbar carries no create control; its pane toggles end the row. **Supersedes N7's and A7's placement and N15's swap** — the property N15 protected (New keeps its place when the search expands) is now the header's, where the control sits after the search. A28's disabled-with-reason stands, stated on the header control. T1's rail New Folder and L41's empty-space menu stay: gestures on a place, not a second button. The empty-folder state's two buttons are gone; its copy names the control at the top. | settled |

**Notes recorded this round:**

- The browser harness in `tooling/file-manager-rulings/` still exercises the self-contained
  mockup, where the masthead's `#newBtn` is the mockup's own; the real surface is asserted by
  `pnpm run lint:matter-create-control`, which refuses a plus-glyph button anywhere the file
  manager renders.
- **Defect found by the A9 check under N29's persistence, fixed in passing:** Escape
  could not close an open menu while focus sat in a field INSIDE the menu — the columns
  menu's own checkbox swallowed the key (the keyboard handler returns early for fields),
  so the menu stayed parked over the list until something else was clicked. It only
  surfaced now because the persisted-open panel narrows the table and slid a row under
  the open menu. Escape now dismisses menus from fields inside them too; fields keep
  every other key.
- Harness: the L47 check now asserts L47b's value set (deleted-view Info included, and
  no "Finding Beneath"/"Not All Scanned" anywhere); T6f's check is replaced by T6h's
  (the check glyph must sit inside the swatch box, no outline, and the label pip's
  computed radius must be 0); D2's check is replaced by D2b's (both restores ask; the
  follow lands selected in Discovery); new S20, P12d and N29 checks; three checks that
  opened the panel unconditionally now guard on its persisted state.

## R17 — round fourteen: the Upload dialog comes first, and nothing is sent until it is asked to

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A17 | **Uploading opens the Upload dialog FIRST, and nothing is sent until Upload is pressed.** The dialog is where a file, several files, or a whole folder are chosen — dropped onto its surface, or picked with its file control or **Choose a Folder** — where the **Upload Location** is chosen beside them (the current folder by default, Home, or any folder through the picker), and where the one commit, **Upload** (never "Save"), starts the transfer. Cancelling before that sends nothing, so there is never anything "landed" to speak of. A folder is recreated under the location, level by level, and its files go inside. Save New Version still asks nothing. **Supersedes A8 and A16.** | settled |
| A18 | A file that did not upload reads **"Upload failed"** — on its own line, and as the title of the notice that names the reason — never "did not land". A file that did reads "Uploaded".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | settled |
| A19 | The dialog carries no running commentary: no "N files — each is uploading now" subtitle, and no "Closing keeps what has already landed in <folder>" line, which read as something saved behind the reader's back. The report pane shows what was chosen, then each file's progress once Upload is pressed, and nothing else.                                                                                                                                                                                                                                                                                                                                                                            | settled |

**Notes recorded this round:**

- The round began with the first production upload, which reported "Nothing answered while sending
  the bytes to storage": the firm's bucket carried no CORS policy, so the browser's preflight to the
  presigned PUT was refused before a byte moved. Provisioning now applies the policy to every new
  firm bucket (`apps/api-worker/src/firm-resource-provider.ts`); a bucket that predates the step
  takes it by hand (the operations runbook, section 15).
- A17's folder support rests on the design-system Dropzone's new `onEntries`, which walks a dropped
  folder through the entry API rather than handing the consumer the zero-byte stub the browser
  reports for it; the file manager recreates the folder tree from the paths it returns.
- A failed download gets a **Retry** beside it, on the Downloads page and in the top-bar tray alike
  — a cross-surface ruling recorded in `design-corrections.md` rather than here.
- Harness: the A16 check pins the mockup's older pick-then-ask sequence and does not cover A17; the
  built screen was checked by hand this round, and the check is replaced when the harness next
  targets the built app.

## R19 — round sixteen: the Upload dialog becomes intake beside source, and a transfer outlives its panel

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A20 | **The Upload dialog is intake on the left and source on the right.** The owner's 2026-09-06 ruling. The left pane is what the files BECOME — the destination matter, the folder, how the files are dated, the document type — and the right pane is the files themselves. **Amends A17's** placement of the chooser on the left; A17's order (choose, say where, press Upload) and its "nothing is sent until Upload is pressed" stand.                                                                                                                                                                                                                                                                     | settled |
| A21 | **One Add control for files and folders.** A menu offering **Files** and **A Folder, With Everything Inside It**, because a browser cannot ask for both in one picker; the two "Choose files" / "Choose a Folder" controls are gone. The whole source pane takes a drop. Several folders can be added in one sitting, each one recreated under the destination.                                                                                                                                                                                                                                                                                                                                             | settled |
| A22 | **The source is the product's one table, nested.** Folders are rows that fold, files sit beneath them at their depth, the header's filters apply; a filter flattens the list to the matching files and turns the Folder column on, the same rule Search Results follow. Sorting keeps every child under its parent (the grid's `orderRows`). The columns are the browse table's facts plus **Status**.                                                                                                                                                                                                                                                                                                      | settled |
| A23 | **Nothing moves when Upload is pressed.** Every control stays where it is and is disabled; the table stays the same table and only its Status column changes; the line above the table turns from the chosen count into the running tally in the same place. The earlier panel re-flowed the moment the transfer began.                                                                                                                                                                                                                                                                                                                                                                                     | settled |
| A24 | **A transfer outlives its panel.** Upload hands the batch to the upload queue; the panel stays to report it and its bar ends at **Close**, which leaves the bytes moving. The top-bar **upload tray** shows every batch — tally, failures, **Retry Failed**, **Open folder** — and the file list re-reads when a batch on its matter finishes. The tray is its own control beside the download tray, not merged into it: the shelf is a durable register, an upload is live state in this tab.                                                                                                                                                                                                              | settled |
| A25 | **Leaving with files chosen asks first.** Closing the panel, and navigating away from the screen beneath it, both put the discard question while files are chosen and not yet sent. A batch already running asks nothing on navigation inside the app (it is the queue's), and the browser asks before the tab closes while bytes are moving.                                                                                                                                                                                                                                                                                                                                                               | settled |
| A26 | **Uploads may land on another matter, and default to this one.** The destination matter is a searchable picker holding the matter on screen; choosing another reads its folders for the folder picker, and "Current Folder" is offered only while the destination is the matter on screen.                                                                                                                                                                                                                                                                                                                                                                                                                  | settled |
| A27 | **A file is dated by its own date or by the upload, the reader's choice, defaulting to its own.** The device's last-modified instant is kept on the version either way (`file_version.source_modified_at`) and reads in the inspector as **File's Own Date**; a date in the future is clamped to now.                                                                                                                                                                                                                                                                                                                                                                                                       | settled |
| A28 | **A failed upload leaves nothing behind.** The reservation is aborted when the bytes do not land, so no row with no size survives in the list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | settled |
| A29 | **Progress is bytes, and a transfer can be stopped.** A sending row reads "Sending · 42%", the bar over the table and the tray's bar measure bytes sent against bytes asked for (a file count sat at "almost done" for most of a batch with one large file in it), and **Cancel Upload** stands beside the tally while the batch runs: what landed stays, what is being sent is given back, what had not started reads **Not sent** and can be sent afterwards with **Send the Rest**.                                                                                                                                                                                                                      | settled |
| A30 | **A file over the firm's mode threshold uploads in parts.** Above the threshold (100 MB unless the firm sets otherwise) the browser runs the multipart ceremony the host already tracked: fixed 16 MiB parts, three in flight, each signed and sent on its own, a failed part resent by itself with backoff, and the storage's ETags handed back as the completion manifest. The single-shot PUT below the threshold is retried the same way. Nothing on screen distinguishes the two legs; the reader sees one upload.                                                                                                                                                                                     | settled |
| A31 | **A file the firm already holds is not sent.** The browser hashes each file first, streamed a chunk at a time through a Web Worker with the row reading "Reading · 42%", so a file of any size is asked about before a byte of it moves, and asks the firm what it holds. A live file on the matter with those bytes reads **Already here** and nothing is sent or made; a live file elsewhere in the firm is duplicated server-side onto the matter, with the gate's verdict carried across, and reads Uploaded. A folder re-sent after a failed batch therefore sends only what did not land. The question is an economy: a host that cannot answer it costs nothing but the upload proceeding as before. | settled |
| A32 | **The rate and the time left are read while a batch runs.** From byte samples over a trailing eight-second window; printed as "2.4 MB/s · about 40 s left", rounded to what a reader can hold and said as an estimate; a stall reads as stalled once the whole window has seen nothing move, and a file the matter already held moves nothing and adds nothing to the rate. In the panel's tally, the tray and the Uploads page alike.                                                                                                                                                                                                                                                                      | settled |
| A33 | **Uploads has a page of its own, as Downloads does.** `/uploads` lays out every batch this tab is running in full — destination, tally, bar, the acts (Cancel Upload, Retry Failed, Send the Rest, Open Folder, Clear) and the same source table the dialog showed, through one component (`upload-source-table.svelte`). It reads this tab's queue, not the server, and says so: an upload lives in the tab. It is reached from the far end of the sidebar's footer utility tray, beside Downloads (amended 2026-09-07 — it sat in the sidebar registry unstarred by default before); the tray offers it under its list, as the download tray offers Downloads.                                            | settled |

**Notes recorded this round:**

- The round began with every production upload failing at the PUT. The cause was not the bucket this
  time but the reservation itself: it answered `Content-Type` beside the presigner's `content-type`,
  the browser merged the two into one doubled value, and the signature no longer matched. The
  development route never checks the signature, which is why the test pool had been green. The fix and
  its test are in `apps/api-worker/src/routes/uploads.ts` and `apps/api-worker/test/uploads.test.ts`.
- A22 rests on a small extension to the one grid: `orderRows` on the grid state and the exported
  `gridRowComparator`, so a hierarchy sorts by exactly the rule the flat table uses.
- Harness: `tooling/file-manager-rulings/` pins the retired mockup and cannot see this dialog, so
  the round adds `tooling/upload-rulings/` (`pnpm check:upload-rulings <gallery-url>`), which drives
  the dev gallery at `/developer-console/upload-states` — the real dialog and tray over the real
  queue with a timed stand-in for the network — and asserts A18, A20–A27 and A29 against the built
  surface, A23 by measuring the frame before and after the press, A32 by the tally's rate and A31
  by the Reading row the stand-in plays and the Already-here row it answers. A28, A30 and the server side of A31 are
  host and transport behaviour, pinned by `apps/web/test/file-upload-destination.test.ts`,
  `packages/file-manager/test/duplicate-version.test.ts` and the upload route tests.

## R18 — round fifteen: the pane toggles move down to the counts strip

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| N31 | **Both pane toggles end the counts strip, not the toolbar.** The owner's 2026-09-03 ruling. This surface never had the complaint that prompted it — the four financial ledgers each grew a ROW to hold one glyph, while these two ended a toolbar the screen draws anyway — but the answer has to be in one place across the product, or a reader has to remember that it sits at the top of one screen and the bottom of four others. Both come down: the folder tree's glyph first, the details panel's second, in the order the panes sit on the screen. The details panel's is the shared `DetailsPanel.Toggle`, so this surface and the four ledgers cannot drift apart again. The folder tree's is written out in the footer, because this is the only screen that has a folder tree to hide: a component shared by one caller is indirection rather than reuse, and naming a folder-tree control after the details panel would be a plain misnomer. **Amends N30's** "its pane toggles end the row" — the toolbar now carries neither the create control nor the toggles, and is where a reader goes somewhere rather than where they arrange the panes. | settled |
| N32 | **Every glyph control in the counts strip is the small square.** One band wears one chrome, and the small square (`icon-sm`) is the one that fits inside the strip's own minimum height rather than pushing it four points taller. Undo, redo, their two carets and the two zoom steps all step down with the toggles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | settled |

**Notes recorded this round:**

- **The folder tree keeps its toggle, for now.** The owner weighed removing it outright — this is
  the only screen in the product that lets a reader hide its own navigation, and the divider already
  drags the rail down to a sliver, so the width is the reader's either way — and chose to keep both
  toggles and revisit. Nothing in the arrangement depends on the answer: dropping it later is one
  button and one preference.
- The candidates were compared as built UI rather than described: `/developer-console/pane-toggle-placements`
  renders each placement over one fixture, this surface included, at one fixed height so what each
  costs the table is the visible difference between two specimens.

## R19 — round sixteen: the table's own controls are shared components

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L42b | **The clear-filters control lives in the control row above the table, where the filters were set** — the owner's 2026-09-03 ruling, applied to every table on the platform. It is `DataTable.ClearFilters`, one shape everywhere, and it is present only while something is narrowing the view. **Revises L42's placement**: the footer keeps the count ("x of y · filtered on Status, Matter") and its inline "Show all", which is the sentence's own remedy rather than a control in a control row. L44's presence-only rule is unchanged and is now the component's. | settled |
| A15c | **The undo and redo pair is `UndoRedoControls`, and it lives in the footer on every surface that has a stack** — the owner's 2026-09-03 ruling. A15b's placement for this surface is unchanged and is now the platform's; the Time Sheet's toolbar pair moved down to join it. The pair's shape, wording, split control and keys are the design system's, not a surface's.                                                                                                                                                                                              | settled |

**Notes recorded this round:**

- **N32 settles the chrome this round had to guess at.** `UndoRedoControls` carries no size or
  register of its own: the counts strip wears one chrome, so the pair is the ghost small square like
  everything else in the band, and the Time Sheet's pair takes it too now that TS9 has moved it into
  the strip. The `variant` prop this round shipped is removed — a control that took its look from its
  caller is exactly what N32 rules against.
- The four undo and redo dropdowns on the product threw when opened — `DropdownMenu.GroupHeading`
  with no `DropdownMenu.Group` above it, on both surfaces, because the markup was copied rather than
  shared. Fixed by the shared control, which has a story that opens the menu.

## R20 — round seventeen: one search, one anchor, and the ink the whole document starts from

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| S21 | **The toolbar carries no search field.** The matter is searched from the matter header and nowhere else, which is what S1 said before this surface had a header search to defer to; the toolbar's own field was the second one. It is gone, and with it the icon that opened it. What reaches this table instead is the query in the ADDRESS (`?q=`), read by the Files page through `queryFromUrl()` — the same way `?entry=` already hands a section a record — so a query still opens Search Results, losing it still leaves, and a search survives a reload and can be handed to a colleague. **Amends S12's** placement of the field: there is no field on this surface to place.                                                                                                         | settled |
| S22 | **Search Results stays, and stays reachable.** S17b stands: the rail row is always there, and clicking it with no live query is not a dead click — the view opens on its own empty state, which names the matter's search as where a search starts. What changed is that the state is the results view's own rather than the folder's ("Nothing in This Folder" was answering a question nobody asked here), and that the scope strip renders only once there IS a query, since there is nothing to scope until then. **Open for the owner:** pointing the matter search's Files scope at `/matters/{id}/files?q=` would land its full results in this table, where the whole set can be acted on (S8); today "Open full results" goes to the matter's own results page for every scope alike. | settled |
| T7  | **The rail says nothing when it holds no folders.** "No folders yet. Everything on this matter sits at the top level until one is made." is gone. The root row still stands with the control that makes a folder beside it, which has already said everything the sentence did. `FolderTree`'s `emptyMessage` lost its default with it: a rail given no sentence shows none, and the folder picker — a different surface, where the emptiness does need explaining — keeps its own.                                                                                                                                                                                                                                                                                                            | settled |
| L48 | **The header menu's display settings sit in its ROOT, not under Columns.** Columns holds columns: the roster, hidden ones included, because a hidden column has no header left to right-click. Row shading and the surface's own toggles are not columns and are not filed under one. Promoted to `design-corrections.md`, since it is every table's menu.                                                                                                                                                                                                                                                                                                                                                                                                                                     | settled |
| N33 | **The icon view's settings control goes BEFORE the list-or-icons swapper.** The settings control belongs to the icon view alone, so it comes and goes; the swapper is on every view. Ending the row with the one that comes and goes moved the swapper sideways each time the reader changed view — the property N15 protected for New, applied to the other end of the same row. Promoted to `design-corrections.md`.                                                                                                                                                                                                                                                                                                                                                                         | settled |
| L49 | **The breadcrumb's black-in-dark-mode was never this surface's defect.** Nothing here was miscoloured: the DOCUMENT declared no `color-scheme` and no root text colour, so the browser painted its own light-mode system colours underneath every theme and any element written without a colour took `canvastext` — black. The view title in the breadcrumb (History, Deleted Files, File Analysis, Search Results) was one such element and is what the owner saw. Fixed at the root for the whole product, and the crumb also names its own ink now.                                                                                                                                                                                                                                        | settled |

| N34 | **The create control reads the bare "New" here, and its menu items carry the noun.** It read "New File" while opening New Document, New Folder and Upload Files — a label naming one of three things, wrong about the other two. **Supersedes N30's label**; N30's placement (the matter header, beside the search, one width on every section) is untouched. The registry says so rather than the control reading it off the page's claim (`CREATE_SEVERAL_KINDS` in `sections.ts`), so the label does not change under the reader as the section mounts. The rule is the product's, not this surface's: `design-corrections.md` carries it. | settled |

**Notes recorded this round:**

- The dark-mode finding was reproduced before it was fixed and measured after: on the running app in
  dark mode, an element with no colour of its own computed `rgb(0, 0, 0)` with the document base
  removed and the theme's ink with it in place. That is the whole defect, and it explains why the
  rail's own rows (History and its neighbours) were correct while the crumb beside them was not —
  those rows name `--mc-text-default` in their recipe.
- `color-scheme` also hands the browser the dark canvas behind an overscroll, dark scrollbars and
  dark form controls, none of which any token reaches. `test/document-base.test.ts` pins the
  declarations, since the failure mode is silent and reads as a component bug.
- S21 leaves `manager.searchScope` and the include-deleted option where they were. They belong to
  the results view, not to a field, and the matter search carries its own copies of both (S18, S19)
  — reconciling the two is the follow-up S22 leaves open.

## R21 — round eighteen: the folder path holds still

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| N35 | **Home is pinned beside back, forward and up, and never scrolls away.** It stays the head of the path and it stays the home icon (N4, T3), but it sits outside the part that scrolls: under a deep path it was the first crumb to leave the screen, and the way back to the top of a matter is not something a reader should have to scroll for. Its hover box still matches the toolbar buttons exactly (N25), which is now what it is measured against rather than a coincidence.                                                                                                                                                                                                                                                                                                                                                                                                    | settled |
| N36 | **A path deeper than its room folds its middle behind an ellipsis, and the toolbar never changes height.** The fold keeps the folder under Home and the last two — where the reader is, and what it sits in — and pressing the ellipsis opens the folded folders as a menu, one press to any of them. It is the design system's one collapse rule (`collapseBreadcrumb`), so the file manager's path and the `Breadcrumb` component cannot fold differently. What still does not fit scrolls, and the strip hides its scrollbar (`mc-scrollbar-hidden`) and draws the gilt edge rule instead: a scrollbar that arrives with a deep path and leaves with a shallow one takes its own height out of the row every time, which is the reflow the owner reported. The strip holds itself at its far end, so the folder the reader is standing in is never the crumb scrolled out of sight. | settled |

**Notes recorded this round:**

- **Reserving the scrollbar's space was the other way to stop the reflow, and it costs the row's
  height.** A gutter reserved at all times is eight points of toolbar that are empty whenever the
  path fits, and a gutter that keeps the crumbs optically level with the buttons beside them costs
  the same eight points again in padding — the row cannot both reserve the space and stay the height
  the owner approved. Hiding the scrollbar keeps the row exactly as it is at every depth, and the
  fold means a path that needs scrolling at all is now the exception rather than the deep case. The
  rail's nav list already hides its own for the same reason, so this is the second consumer of one
  recipe rather than a new idea.
- The fold is not the `Breadcrumb` component: this path's crumbs are ghost buttons on the folder
  tree (N25), not links, and revealing the folded folders in place would only make the strip longer
  again. What both surfaces share is the rule that decides which segments survive, which is why it
  moved into `collapse.ts` rather than being written twice.

## R22 — round nineteen: the Upload dialog holds still, tabs down its left, and the duplicate setting goes

The owner's notes of 2026-09-09, staged ahead of the work and built on 2026-09-11. A39 is the one
row left open here: its cause is in the design system, and it is settled there rather than worked
around in the dialog.

| #   | Ruling                                                                                                                                                                                                                                                                                                                                            | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A34 | **The Upload dialog does not resize itself to what is in it.** Its frame is fixed and it is sized for **Advanced Settings open**, so opening the settings, adding files, or expanding an intake folder never moves anything already on screen. The panes scroll inside the room they have; the dialog does not grow to meet them.                 | settled |
| A35 | **The dialog's left side is tabs, not one stacked form.** Tab one is **Location**; tab two is **Advanced Settings**. Tabs are the modular shape: a third and a fourth arrive later without the dialog being redesigned around them. Amends **A20** only in how the left pane is composed — intake stays on the left, the files stay on the right. | settled |
| A36 | **The right pane says whether each file is ready to be uploaded** — that is, whether its hash has finished. Readiness is the file's own state in the source list, shown per file.                                                                                                                                                                 | settled |
| A37 | **The Add menu names both choices: "+ Folder" and "+ File".** "+ Folder" replaces "A Folder, With Everything Inside It". "+ File" is listed even though pressing Add already opens the file picker, so neither choice is discoverable only by pressing and finding out.                                                                           | settled |
| A38 | **"+ Add" is a real button** — edges, and the design system's button standards, like every other button on the screen.                                                                                                                                                                                                                            | settled |
| A39 | **The table's right-click menu renders above the dialog, not beneath it.** It currently paints under the modal layer, which makes it unreachable — the menu is there and cannot be used.                                                                                                                                                          | settled |
| A40 | **A failed upload says what failed.** The user is told the nature of the failure, not only that one happened.                                                                                                                                                                                                                                     | settled |
| P16 | **"Files the Firm Already Holds" is not a setting — remove it.** There is one behaviour and it is the default: a file whose hash the firm already holds is not uploaded again. Deleting one instance does not delete the stored bytes; they go only once **every** instance of that hash has been deleted.                                        | settled |

**Notes recorded this round:**

- **A39's cause is one line in the design system, not the dialog.** Every floating surface composes
  its stacking through `floatingContentClasses()` in
  `packages/design-system/src/lib/internal/floating.ts`, which is the single home for the z-layer
  scale. Combobox, date pickers, dropdown menus, popovers, selects and tooltips all take the
  `anchored` layer, which that file records as deliberately sitting ABOVE `modal` so a picker opened
  from inside a dialog is clickable. `context-menu-content.svelte` and
  `context-menu-sub-content.svelte` take `dropdown` instead, which sits BELOW `modal` — so a
  right-click menu raised inside the Upload dialog paints under the panel exactly as reported. The
  two context-menu parts are the only floating surfaces on the old layer.
- The Upload dialog's own duplicate machinery is what P16 removes, and it is more than a label:
  `checkDuplicates` is a plan field read by the queue (`upload-queue.svelte.ts`), it gates whether
  the hash is read at all (`upload-dialog.svelte` starts no read when the question is off), and
  A36's readiness reading is that same hash. Turning the question into the only behaviour makes the hash
  unconditional, which is what lets readiness be stated for every file rather than only when the
  setting happened to be on.

**Notes recorded when the round was built (2026-09-11):**

- **A34's height is pinned on the source pane, not on the shell.** `ActionDialog` deliberately has
  no `class` or `style` prop, and its frame fits its content; so the dialog's context root carries
  `block-size: min(72vh, calc(var(--mc-size-record-window) * 0.625))`, the record windows' own
  measure, and the intake beside it stretches to match. The modal stage still caps the frame at the
  screen less its gutter, and the pane shrinks inside that (`min-h-0`) rather than pushing past it.
  Every pane already wears `mc-scrollbar` through the frame recipe.
- **A35 replaces the accordion with `Tabs`**, Location first on every open. The "Destination"
  heading went with it: a tab called Location does not need a heading saying so above its two
  fields. The two helper paragraphs under Advanced Settings (the duplicate explanation, the note that
  a document type is set per file) went too, under the standing rule that a data-entry surface
  carries no helper prose.
- **A36's readiness is the register's, and the batch inherits it.** `upload-digests.svelte.ts`
  asks the firm (`uploads.matches`) the moment a digest is in and settles each file as `ready`,
  `held` or `unread`; the Status column reads Reading · N%, Ready, Held or Not read before the press,
  and a folder row reads "2 of 3 ready · 1 held". `UploadBatchPlan.readiness` carries the panel's
  last reading into the batch so every item starts where it stood, which is the A23 no-reflow rule
  applied to the one column that is allowed to change. The firm's answer is asked against the
  destination at the time; "held" is a fact about the firm, so a destination changed afterwards does
  not unsettle it, and the lane asks again at its turn to learn whether the match is on the matter
  or elsewhere.
- **A37 and A38 are one control: the secondary button wearing the dropdown menu**, the shape
  `CreateControl` already gives every menu-bearing control, with "File" and "Folder" as its two
  items behind the plus glyph. The split control (a button whose press opened the file picker and a
  chevron beside it) is gone; it was the thing that did not read as a button. What this trades away
  is R21's one-press-to-picker for files, deliberately: the design system's menu opens on hover, so
  a pointer reaches File in one click, and the owner named the two items outright. If the owner
  wants the press to open the picker again, it is one handler on the trigger, not a redesign.
- **A40 is a second string, not a longer one.** `uploadFailure(outcome)` answers `failure` (the
  server's own `detail`, its `title` where it gave only that, or "The firm's storage did not
  answer" / "Nothing answered while …" for a transport fault) beside the whole `reason`. The row
  shows the short line under the file's name in the danger register with the whole account on
  hover; the tray lists up to three failed files with their lines under a finished batch; the
  Uploads page gets both through the shared source table.
- **P16 on the server is a guard with no caller, by design.** `purgeableVersionObjects` in
  `packages/file-manager/src/file-service.ts` is the one door to destroying a version's bytes: it
  refuses a live file, and for a deleted one names each object as destroyable or retained by
  counting every OTHER `file_version` row — any file, live or soft-deleted, any status — holding the
  same content hash or the same key. Nothing calls it today because deletion is a soft delete that
  destroys only the working copy and default retention is indefinite
  (`docs/specs/2026-08-25-deleted-files-retention-design.md`); the retention policy engine walks it
  when built. Two tests pin the rule: `packages/file-manager/test/deleted-bytes.test.ts` (two rows,
  one delete, the object retained and held by one; two deletes, still retained) and
  `apps/api-worker/test/files-shared-bytes.test.ts` (through the real DELETE route: both objects
  remain and the survivor downloads). The decision is recorded as an ADR fragment.
- **Harness:** `tooling/upload-rulings/index.mjs` still asserts A21's menu labels ("files", "a
  folder …"), A20's "on arrival" text, and the A31a Reading row against the stand-in; the first two
  are now stale against this round and the harness is not this round's to edit. The built dialog
  was not driven in a browser this round; the Status column's readiness words, the tab strip and
  the pinned height are unverified visually.

## R23 — round twenty: the list is the one scroll region, the acts can be taken back, and a file is filed by being dragged

The owner's notes of 2026-09-14, from the deployed screen.

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| N37  | **Only the file list scrolls.** "When the list gets long and I scroll, I am scrolling the entire page... The only part that should scroll is inside where the files are. In that way it maintains its look as one screen." The matter header, the section strip, the file-manager toolbar and the counts strip all hold still at any list length; the grid's own scroll region is the one that moves. Root cause below, and it was never this surface's own markup.                                                                                                                                                                                                                                                                  | settled |
| T9   | **One selected treatment down the rail, whatever the row names.** A chosen folder wore the accent tint with the gilt edge; the four view rows beneath it wore `surface-selected`, which on a SUNKEN rail is very nearly the rail's own colour — so the open view read as barely marked beside a folder that was plainly lit. The view row now carries the tree row's own selected declarations. Where the reader is standing is one fact and cannot look like two states.                                                                                                                                                                                                                                                            | settled |
| L50  | **A tile's name wraps, and no tile covers its neighbour at any name length.** The tile has a fixed width and its whole job is to name one file, so the name breaks onto a second and a third line rather than being cut at the first — #607's standing rule for a navigation row, applied for the same reason. Past the THIRD line it ends in an ellipsis and the whole name is on the tile's hover, so a folder of long names stays a grid of even tiles rather than a column of tall ones. The overlap itself was a box never told it could shrink; the wrap is honest only once it is.                                                                                                                                            | settled |
| L51  | **The pin's space is reserved whether or not the thing is pinned.** "So we don't have reflow." On a tile the gutter opens at the start of the GLYPH's line and an equal space closes it, so the icon stays centred and pinning lights a glyph and moves nothing; on a tile this narrow a gutter each side of the NAME would have taken a third of the room the name is there to use. L11 and L38 are untouched: same Lucide pin, filled when pinned, still above the rule. **The TABLE row's pin is reserved the same way**, in the design system's own grid — see the note below.                                                                                                                                                   | settled |
| A29b | **Undo and redo are wired to the acts.** Renaming, moving between folders, pasting a cut, deleting a FILE and pinning each record a step; each step is a command with a real inverse and never a snapshot, and each names the act it will take back. A15, A15b and A15c are unchanged — the stack, the placement and the control were never the defect. **Extends A15's movement-only scope**, which is what left the pair disabled through most of a session.                                                                                                                                                                                                                                                                       | settled |
| A30b | **A folder's delete is refused out loud rather than half-offered.** There is no route that brings a folder back, so no step is pushed for one; the screen states it in its own band and names Deleted Files, where the documents the folder held can still be recovered one by one. A22's dialog is otherwise untouched.                                                                                                                                                                                                                                                                                                                                                                                                             | settled |
| I51  | **The details panel hosts its own rename field and commits a name through it.** The list's rename is still the list's (F2, the row, the context menu); what the panel had was a button that opened the field on the ROW, which is not renaming from the panel. The panel commits a name and this surface runs the list's own path for it — the same collision refusal (L45), the same write, the same undo step — so a name typed on the right behaves exactly like a name typed on a row. I39 is what this builds.                                                                                                                                                                                                                  | settled |
| L52  | **A field that opens is a field the cursor is in.** "I press create new folder. The name field appears as a field, but I have to click it then unselect it in order to make it look normal." The list's in-place field was never focused and never selected, where the panel's field built this same round had both from the start. A new folder arrives under a stand-in name nobody chose, so the cursor lands in it with the stem selected; the extension is not, for the reason I51 gives.                                                                                                                                                                                                                                       | settled |
| L53  | **Opening a rename does not move the row.** A grid cell is exactly one control tall and spends four pixels of that on block padding each side, so a control asking for the full control height cannot fit in one and pushed the row taller. The field gives up the control's own minimum and takes the cell's content box instead. A REFUSAL still grows the row, which is right: the reason has to be readable, and it sits beneath the field.                                                                                                                                                                                                                                                                                      | settled |
| L54  | **A file or a folder is FILED BY BEING DRAGGED, everywhere the screen shows one.** "I should be able to drag and drop files to move them in or out of folders. This includes in the left sidebar, the breadcrumbs, and in the main area. Should likely be a common component." A row in the list, a tile in the icon grid and a folder row in the rail are sources; a folder row in the rail, a folder row or tile in the list, and every crumb including home are destinations — a crumb is how something comes back OUT of a folder. Dragging one row of a selection carries the whole selection and the drag image says how many. It is ONE component, not four copies: the rail's own handlers were the first copy and are gone. | settled |

**Notes recorded this round:**

- **The drag is a design-system primitive, and the rail was rewritten onto it rather than left as
  the fifth copy.** `packages/design-system/src/lib/components/item-drag/` owns the payload, which
  destination is under the pointer, the mark drawn on it, the refusal, and the clearing on
  `dragend` however the gesture ended; the surface owns only what may be dragged, what may accept
  it and what a drop means. It is a component directory rather than an internal helper because it
  ships a recipe of its own (the mark and the drag image's count), and an internal helper with a
  stylesheet is a component wearing a different name.
- **An upload and a move are the same event on the same square inch, and the PAYLOAD tells them
  apart — never the target.** A transfer carrying `Files` came from the desktop and opens the
  upload dialog; one carrying our own vendor media type came from a row on the page and is a move.
  Our own type is excluded from the file question explicitly rather than by omission, because a
  browser is free to add `Files` to a transfer we also wrote to, and an upload dialog opening over
  a row somebody was merely filing is the defect that would follow. L15's drag-and-drop upload is
  untouched in what it does; what changed is that `Dropzone` now DECLINES a drag it can positively
  identify as ours, which is what leaves the drop for the move to take — a dropzone that lit up for
  a row being filed would claim a drop it then silently swallows, there being no files on it. It
  refuses only what it recognizes and never demands `Files` on the way in: a transfer's type list is
  the browser's to populate, and a dropzone that goes dark for a real file drop is worse than one
  that lights up for a move.
- **A refusal is the POINTER, not a banner.** A destination that will not take the drop simply does
  not prevent the event's default, which is how the platform is built: the cursor turns to "no
  drop" and the reader is told before they let go rather than after. Four refusals — a destination
  that is not a folder, a folder into itself, a folder into its own descendant (the one that
  actually loses documents, by detaching the branch from the matter), and anything into the folder
  it already sits in. They live in `apps/web/src/lib/file-manager/file-drag.ts` with a test each,
  because a rule a reader never sees stated in words cannot be checked by reading the screen.
- **A mixed selection is not refused for its worst member.** Eight files dropped on a folder one of
  them already sits in move the other seven. Refusing the whole gesture would make undraggable
  exactly the selection a reader is filing — one gathered out of several folders.
- **A drop is `moveRows`, which is the clipboard's own path.** Same write, same refusal, same step
  on the undo stack, so an undone drag puts the files back and a move made by pointer is
  indistinguishable from a move made by menu. A29b needed nothing added for this.
- **Keyboard parity was already there, and a second way was NOT added.** Cut (Ctrl X) and Paste
  (Ctrl V) are on every right-click menu with their shortcuts and reach the rail's folders too, so
  every drag has a keyboard equivalent that works without a pointer. A separate "Move to folder"
  picker would be a third answer to one question, which is what A1 and the create control's ruling
  both refuse.
- **The list's rows are lifted into being draggable for the press they are under.** The rows come
  out of the shared table, which stamps no `draggable` on them — nor should it, since a table whose
  every row is permanently draggable loses text selection on every surface that composes it. The
  drag sets the attribute on `pointerdown` and gives it back on `dragend`. The cleaner shape is a
  prop on the grid saying its rows are draggable, which is a change to a component this round does
  not own.
- **The mark is an EDGE, not a fill.** A destination under the pointer has to read over whatever the
  row already is — selected, striped, pinned, marked as cut — so it takes the one channel none of
  those use. A fill would have to win a specificity argument with every row state on every surface,
  and would land as a wash of accent across the work surface, which the design language keeps for
  the edges. The rail adds its own wash on top, so a destination there reads the same as a row a
  menu was opened on.
- **The rail's mark moved from the treeitem to the ROW.** A treeitem holds its open children, so a
  mark painted on it ran down the whole branch beneath the destination — visible only on an expanded
  folder, which is why the copy it replaces never showed it.
- **The screen was not driven in a browser this round.** The gesture is asserted by the primitive's
  story (which dispatches the real event sequence over a stand-in transfer) and by the rail's own
  story; the four surfaces wired together, the drag image's count and the mark's appearance are
  unverified visually.
- **N37's cause was one utility, and it reached every working surface in the product.** A screen of
  this shape renders inside `FullHeightSection`, which sits in a column whose height is
  `min-height: 100%` over an auto height — deliberate, so an ordinary document section can still
  grow past the fold. The section asked for its share with `flex-1`, which is `flex: 1 1 0%`, and a
  PERCENTAGE basis against a column whose main size is content-based resolves to the item's own
  content. So the section reported the whole table as its base size, the column grew to meet it, the
  minimum never applied, and nothing downstream was ever capped: the canvas scrolled the matter
  header off the top while the list never scrolled inside itself at all. A definite basis (`h-0`
  with `grow`) gives the column its minimum back. The four money ledgers and the two document pages
  compose the same component and inherit the fix — they had the same latent defect and it showed
  later only because their tables are shorter.
- **The undo defect was never the stack or the control.** `HistoryStack`, `UndoRedoControls` and
  `historyShortcuts` were all wired correctly; `moveRows` was the only act that pushed anything, so
  four acts out of five recorded nothing and the pair sat disabled. The steps now live in
  `apps/web/src/lib/file-manager/file-manager-history.ts` with a test per act
  (`apps/web/test/file-manager-history.test.ts`), because an inverse written inline in a
  two-thousand-line component is an inverse nobody exercises.
- **A move recorded an origin BEFORE its write, so a refused move still landed on the stack** and
  undo would have offered to put back something that never left. Origins are recorded per key, only
  after that key's write has answered.
- **A file's delete restores into the folder it came out of**, not through the route's own fallback.
  A restore with no destination falls back to the matter root when the old folder has gone, which is
  the right default for a reader browsing Deleted Files and the wrong one for an undo, where the
  folder is still there and is where the file belongs.
- **A pin step carries only the keys the act CHANGED.** Pinning over a selection that was already
  half pinned would otherwise unpin, on the way back, rows the reader had pinned earlier.
- **The table row's pin is the design system's, and reserving it is every table's.**
  `data-table-grid.svelte` drew the glyph inside the first cell only while `mark.pinned` was true,
  so pinning shifted that cell's content by the glyph and its gap. The slot is now kept by any grid
  that marks rows at all — the condition is whether the table was given a `rowMark` at all, a
  capability that cannot change under the reader, rather than whether anything is pinned right now,
  which changes at exactly the moment the reflow would be seen. A grid that never marks a row
  reserves nothing and is unchanged. Done in the component and its recipe rather than worked around
  with a second pin drawn in the file manager's own cell.
- **The two rename fields answer refusals in different places, and that is the seam.** The rename
  path now returns the sentence that refuses instead of posting it itself: the list's field sends it
  to the screen's failure band, the panel's field keeps its own field open with the reason beneath
  it. A single path that also decided WHERE to say no would have put a band at the top of a screen
  the reader is not looking at while they retype a name on the right.
- **A rename opened from the list had no cursor in it at all.** What the owner hit through the new
  folder was not the new folder's defect: every route into the list's field — F2, the context menu,
  a folder just made — opened a field nobody was typing in. One focus, in `beginRename`, covers all
  three.
- **The rail is not adopting `NavigationLayout.Row`.** Its `current` register is `surface-selected`
  over the canvas, which is right for a column sitting on the work surface and is precisely the fill
  that disappears on this sunken rail. What the two share is the RULE — one lit row, the gilt start
  edge, firmer ink — not the token, and T9 settles this rail on the tree's own register instead.
- The screen was not driven in a browser this round: the scroll chain, the rail's selected fill and
  the icon tiles are asserted by the reasoning above and by the lints (`lint:page-inset`,
  `lint:scrollbar`), and are unverified visually.

## R24 — round twenty-one: the list holds one line per file, the scale reaches it, and a second person's edits

The owner's notes of 2026-09-16, on the list's geometry and on what two people working at once do to
one file. Five of the seven are one defect each; L57 is a column leaving, and C1 is not a complaint at
all but a question the screen had never been made to answer in writing.

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| L55 | **A row in the list is ONE LINE TALL, and its first cell's text sits on the same baseline as every other cell's.** The row-mark slot the grid reserves in each first cell was an inline box, and every surface that composes a first cell out of an icon and a name composes it with flex — which is block-level, so the mark took a line of its own ABOVE the content. That is the band of empty space over every file name, and it is why the name read low in a row whose other cells were still centred: they were centring in a row a line taller than it should have been. The slot is now the cell's own leading padding with the pin painted into it, so the cell holds exactly one in-flow child whatever a surface renders there.                                        | settled                      |
| L56 | **There is a line under the last file, the same line every other file has under it.** The table-card's last row gives up its hairline because the card's own bottom rule runs a hairline below it; the file manager's table has no card — the toolbar above and the counts strip below are its frame — so the rule left the last file as the one row with nothing under it. The grid now takes a `frame` of `card` or `flush`, and flush keeps the hairline and lets the surface continue past the last record instead of the table ending mid-frame.                                                                                                                                                                                                                              | settled                      |
| L57 | **The Location column is gone from the file list.** A folder listing already answers "where is this" in the path above it and the tree beside it, so the column restated the one fact a reader cannot get away from, once per row — which is why it had to ship hidden. A column whose only honest setting is off in the view a reader lives in is not a column that view has. It stands in Search Results and File Analysis, where rows genuinely come from different folders and the question is real. Supersedes **L27.2** in the half that put it in browse.                                                                                                                                                                                                                   | settled                      |
| L58 | **File Type reads in the table's own face.** It was set in the monospace face, which made one column of a list of plain words look like a column of code and put a second typeface on a screen that has one. **L32** governs what the column SAYS (always the extension); nothing ever asked for it to be lettered differently.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | settled                      |
| N38 | **The scale control scales the LIST, not only the icon grid.** It moved one thing in list view — a step between two densities, at one threshold, in the middle of a ten-step range — so nine of the ten steps changed nothing a reader could see, which is the "zoom does not work between the two views" the owner reported. The list's text, its row height and the glyphs inside its rows now take the scale as a multiplier, across every view the surface renders, the inside of an archive included. The header band and the counts strip do not: they are the frame around the list rather than the list, and growing them pushes the rows a reader asked to see more of off the screen. **L39b** stands unchanged on what the control looks like and what range it covers. | settled                      |
| C1  | **A file moved, renamed or deleted by somebody else while a first person is editing it.** Answered below — the bytes are safe by construction, the delete is coordinated, and what is missing is on the reader's screen rather than in the data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | settled, with two gaps named |

### C1 — two people, one file, one of them editing it

The question as the owner put it: how do we make sure the data stays correct when a file somebody is
actively editing is moved, renamed or deleted by a second member. Read against what is built rather
than answered from principle. There are three acts and they are three different answers.

**A MOVE OR A RENAME CANNOT REACH THE EDIT AT ALL, and that is by construction rather than by luck.**
Every object key an edit touches is derived from the verified edit token's `fileId` and `versionId` —
never from the request line, and never from the file's name or the folder it sits in
(`apps/api-worker/src/editing/CLAUDE.md`, the WOPI handlers). A move writes `file.folder_id`; a rename
writes `file.name`; neither touches a version row, a key, or the live working copy. So the editor
keeps reading and keeps saving, the version it cuts on the way out lands on the same file, and the
file is afterwards exactly where the second member put it, under the name they gave it. There is no
lost update to have, because the two members wrote different columns of different tables.

**A DELETE IS COORDINATED, and the delete route is where that happens.** `DELETE /api/v1/files/{id}`
force-closes the file's live `DocumentSession` BEFORE the soft-delete runs, so an edit in flight is
ended rather than left holding a lock on a row that has gone; the soft-delete then clears the
`current_*` pointer and the working copy's own object is destroyed with it. Every committed version
and its bytes are retained — only a retention policy ever destroys those — so the file is restorable
with its whole history, and a restore puts it back in the folder it came out of. The one thing lost is
whatever had been typed since the last version was cut, which is the honest consequence of a delete
and not a defect in the coordination.

**AN OFFLINE COPY OUTLIVES THE DELETE, and check-in says so rather than failing.** A member holding a
checked-out copy of a file a second member then deletes gets a 404 on check-in — the same answer every
read of that file gives — and the copy stays on their machine. An undelete makes check-in possible
again (`apps/api-worker/src/editing/checkout-routes.ts`). Nothing is silently discarded and nothing is
silently accepted against a record that is gone.

**WHAT IS ACTUALLY MISSING IS ON THE SCREEN, NOT IN THE DATA.** Two gaps, both about what a second
member SEES, and neither one able to corrupt anything:

1. **The file list does not learn.** There is no live channel and no poll on this surface: a member
   looking at a folder keeps looking at the rows as they stood when the folder was opened. Acting on a
   row a second member has already moved or deleted is refused by the server, correctly — and then the
   list still shows the row, so the refusal reads as the app being broken rather than as the list being
   old. The fix is a re-read on refusal at minimum, and the matter's own event stream when there is one;
   it is a screen change, and it does not touch the data model.
2. **A metadata write carries no precondition.** `PATCH /api/v1/files/{id}` takes a name or a folder and
   applies it. Two members renaming the same file within the same few seconds is last-write-wins, with
   no way for the second to be told they overwrote the first. This is the ONE place a real lost update
   lives on this surface, and it is small — a name, not a document — but it is the one the optimistic
   model has not been extended to. The remedy is the shape the check-in already uses: the write states
   the version of the row it read, and a stale one is refused with what the row now says.

**WHY NEITHER GAP IS A HOLE IN THE LEDGER.** The file's CONTENT is versioned, content-addressed, and
never rewritten in place: a version is cut, never edited, and `current` never regresses to a conflicting
copy. Divergence between two offline copies is resolved by a person against a `conflict_pending` copy
that is retained forever, never auto-merged. So the worst a second member can do to a first member's
work is end their session or make them retype a name — never quietly replace their text.

**Notes recorded this round:**

- **L55 and N38 are the same component's two halves, and both were the design system's rather than
  the screen's.** The mark's slot and the grid's scale both live in `DataTable.Grid` and its recipe;
  the file manager hands each of its four lists one number and composes the row glyphs with the
  recipe class that reads it. Fixing either one inside the file manager's own cell snippet would
  have left every other table in the product with the same defect and no way to find it.
- **The scale is a multiplier whose 1 writes nothing, so no other table changed by a pixel.** It
  multiplies the row's text, its height and its inner padding, and the glyphs that ride inside a
  row; deliberately not the hairlines, which blur when scaled, and not the header or the footer.
  The arithmetic is the component's and not the recipe's, because a recipe here is token references
  and structural keywords by gate, and `calc()` is neither — the recipe names the four metrics as
  the tokens they already were, and the component writes the scaled lengths over them inline.
- **The scale no longer drives the density.** It used to be `scalePercent < 100 ? compact :
comfortable`, which is the whole reason nine of the ten steps did nothing: the control's only
  effect in list view was that one flip. Density is a separate axis and the file manager simply
  takes the default; the scale does the work continuously across the whole range.
- **`frame="flush"` replaces the `rounded-none border-0` incantation** that four file-manager grids
  and five money ledgers were each spelling out. Giving up the card is not only paint — the last
  row's hairline and whether the table fills its frame go with it — and three things that must move
  together should not be three utilities a caller has to remember.
- **The mark is painted into the cell's padding rather than sitting ahead of the content**, so the
  cell holds exactly one in-flow child whatever a surface composes there. The previous shape
  (L28's era) worked only while every first cell's content happened to be inline, and every surface
  that puts an icon beside a name uses flex, which is block-level. The reservation is unchanged:
  a table that can mark a row reserves the width on every row, so pinning still moves nothing.

## R25 — round twenty-two: the icon draws the claim, and the analysis says whether it holds

The owner's question of 2026-09-17: a Word document renamed to end in ".do" kept its Word glyph and
its DOCX badge. It did because the icon read the sniffed bytes before the name — a rule the resolver
wrote to keep the icon from lying — while the File Type column in the same row read the name, and
the analysis that owns "the name lies" only knew ten extensions and stayed silent on this one. One
row, three answers. The owner's ruling: the firm already has a system for verifying what a file is,
so the symbol states what the file says it is, and that system says whether it is telling the truth.

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| I51  | **The file icon draws what the NAME claims.** The glyph and its badge resolve from the extension first; the sniffed content type answers only where the name makes no claim (no extension). An extension nobody recognizes draws the blank sheet with no badge, whatever the bytes are — the icon never quietly corrects a name. So the icon, the File Type column (**L32**) and the type in words (Activity, search) all say one thing per row. Refines **I50**, which stands on what each kind draws.                                                                                                                                                 | settled |
| F13  | **Type Mismatch is graded in the file-type vocabulary the icon uses, at the level of kind, over every extension it knows.** A recognized extension naming a different kind from the sniffed bytes is a mismatch; an extension nobody recognizes over bytes the sniffer read is a mismatch too, because it is still a claim; a name with no extension claims nothing; a sniff the vocabulary has no kind for (nothing recognized, or a container it cannot see inside — legacy Office files all read as one compound-file type) is no reading and contradicts nothing. Replaces the ten-entry list the check kept on its own. **F12** holds it at Error. | settled |
| P17b | **A consequence stated so it is not later read as a defect:** a file named `invoice.pdf` that is really an executable draws the pdf glyph and the PDF badge, with the Error mark beside it and Type Mismatch in the analysis. That is I51 working. The alarm is the Safety cell's (**L47**, **F12**), not the glyph's; folding it into the glyph is **P17**, still the owner's open question.                                                                                                                                                                                                                                                           | settled |

**Notes recorded this round:**

- **What is DRAWN reads the name; what is DONE reads the bytes.** The one Open gesture decides its
  editor from the sniffed type first, as it always did, and now says so: a Word document renamed
  `.txt` is drawn as the text file its name claims and opened as the Word document it is, never
  handed to the plain-text editor on the strength of its name. The design system exports the two
  precedences as two functions rather than one with a flag, so a caller has to say which question
  it is asking.
- **The check and the icon share one mapping now.** The analysis used to keep its own list of ten
  extensions and their exact MIME types, so it could only ever contradict names the list happened
  to know, and `.do` was not one of them. It reads the design system's claim-and-reading pair
  instead, so the day an extension is added to the icon's vocabulary it is added to the check's.
- **Kind, not exact format.** A `.docx` whose bytes sniff as the legacy Word type is a Word document
  under a Word name; telling doc from docx is the badge's job (**I50**), not the finding's. Grading
  by exact MIME type would also false-alarm on every format the sniffer names differently from the
  extension (`.m4a` reads as `audio/x-m4a`, `.mov` as `video/quicktime`).

## R26 — round twenty-three: folders sort separately from files

The owner's note of 2026-09-18, in full: "in file manager area, regardless of how files are sorted
(by name), folders should always sort separately from files." One ruling, and its whole difficulty
is in the word "regardless": the obvious reading is a tweak to the name column, and the right
reading is that the kind of a row was never a sort key at all.

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L59 | **Folders form their own run ABOVE the files, in every view that lists the two together, under every column and in both directions.** A folder is a place and a file is a thing inside it, so which kind a row is is a fact about the list rather than a value in one of its columns — which is why sorting by name descending reverses the names within each run and never lifts a file over a folder, and why the rule holds identically on size, on a date, on the type, and on a column added next year. The active sort orders the folders among themselves and the files among themselves, by exactly the comparator the header says it is sorting by. Pinning is untouched: it is the reader's own arranging, applied above the runs as it always was. | settled |

**Notes recorded this round:**

- **There is one function and one seam.** `orderFolderRowsFirst` in
  `apps/web/src/lib/file-manager/file-rows.ts` partitions the rows and applies the grid's OWN
  comparator inside each partition; it is handed to the grid through the `orderRows` option the
  hierarchy already uses (the seam recorded with A22), so no view reimplements a column comparison and no
  column is special-cased. Special-casing the name column is the shape this correction is most
  easily read down to, and it would have given the list a second ordering rule to disagree with the
  header it is sorted by.
- **Which views it reaches, and why the others are not exceptions.** The browse list and its Search
  Results and File Analysis views take it through the one grid, and the icon layout is the same
  grid's `rowsInView`, so the tiles and the rows cannot disagree. The inside of an archive takes it
  too — that format's word for a place is "directory", which is the same list of places and things.
  The upload intake already ordered folders ahead of files within each parent and now does it by
  calling the same function, so the nested listing and the flat one share one rule. Deleted Files
  holds documents alone (there is no route that brings a folder back — A30b), the changelog is not a
  listing of rows of either kind, and the folder rail is folders only: none of the three has a
  boundary to draw.
- **Harness: `tooling/file-manager-rulings/` pins the retired mockup and cannot see this.** It is
  handed an HTML file and reads the mockup's own element ids, so it has no way to reach the built
  screen's table. L59 is pinned by unit test instead —
  `apps/web/test/file-manager-order.test.ts` for the rule itself (both directions, on the name and
  on a second column, the empty partition, and pinning's precedence), and
  `apps/web/test/upload-intake.test.ts` for the nested half. The check is added to a harness the day
  one targets the built app.
