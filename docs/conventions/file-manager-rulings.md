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

| #   | Ruling                                                                                                                                                   | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A1  | Pin, rename, copy, download and delete are **right-click actions**. They are not buttons in a header bar and not buttons in the right sidebar.           | settled |
| A2  | Download, Open in Editor and Save New Version are removed from the right sidebar. Access is by right-click only.                                         | settled |
| A3  | The right-click item is "Download". Not "Download (acknowledge first)" or similar — if an acknowledgement is needed, raise it **after** the click.       | settled |
| A4  | Actions are icons, not text labels, wherever they repeat per row.                                                                                        | settled |
| A5  | Copy and cut. Plain copy — not "copy to another folder". Folders copy too.                                                                               | settled |
| A6  | "New folder", not "New subfolder".                                                                                                                       | settled |
| A7  | The New button is on the left. There is no second New button on the right.                                                                               | settled |
| A8  | Upload opens a real file picker.                                                                                                                         | settled |
| A9  | Renaming: when extensions are hidden, the rename field shows no extension. When they are shown, the selection covers the name only, never the extension. | settled |
| A10 | Template picking must scale to hundreds of templates — a plain dropdown does not. Stubbed for now.                                                       | open    |
| A11 | Document type is a custom, firm-editable vocabulary, and there must be a way to set it.                                                                  | settled |

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

| #    | Ruling                                                                                                                                                                                                                                                                           | Status  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| I37  | The safety report's Copy and Download are small icon buttons, out of the reading's way. Refines I34: both still render from one text, so they cannot disagree.                                                                                                                   | settled |
| I38  | Details carries NO safety sentence. An open finding is one row like every other — a Flag icon (Lucide Flag) whose click opens the Safety tab. All details rows read alike. **Supersedes I20.**                                                                                   | settled |
| L32  | The File Type column always shows the extension — "mp4", "zip", "docx" — never the processing category. **Supersedes I16**: the extension tells `.doc` and `.docx` apart on its own. Archive members too.                                                                        | settled |
| L33  | A zebra setting sits directly beneath the file-extension setting in the columns menu: alternating row shading, design tokens only, with selection and hover keeping the last word.                                                                                               | settled |
| L34  | The per-column filter button sits inside the same header cell as the label it filters — one unit, one hover surface covering both. Refines L30: its space is still reserved, so revealing it moves nothing.                                                                      | settled |
| L35  | A column can be pinned: it holds its place under horizontal scrolling (`position: sticky`), discoverable where column controls already live (the columns menu), shown with the Lucide pin.                                                                                       | settled |
| L36  | Filtering works on every column through ONE mechanism parameterized per column type — a checkbox set, a contains-text field, or a from/to range — never per-column copies.                                                                                                       | settled |
| L11b | **Regression:** the pin glyph carried Lucide `star` geometry, not the pin L11 ruled. Fixed: the pin is Lucide `pin` everywhere it appears — pinned rows and column pinning alike.                                                                                                | settled |
| L14b | **Regression:** deleting a file at runtime recorded its deleter as "You", which the deleted list then displayed. Fixed: the deleted record carries the person's name and the file's real authorship.                                                                             | settled |
| A15  | Undo and redo stacks for movement — moves between folders, drag-and-drop, cut/paste. Ctrl+Z / Ctrl+Y (and Shift+Ctrl+Z), plus visible controls beside Back/Forward/Up that say what will be undone.                                                                              | settled |
| N22  | A History changelog in the left sidebar, directly beneath File Analysis and Deleted Files: how files moved, were renamed, deleted, or changed — on the matter's own table (D1b), the breadcrumb titling the view (N21), columns time · action · file · from → to · who.          | settled |
| T7   | Folders can be moved by dragging within the left-sidebar tree. A folder never drops into itself or its own descendants; the move is undoable like any other.                                                                                                                     | settled |
| A16  | Uploading opens a destination modal: the currently viewed folder (default), the root, or any other folder through a folder picker. A8's real file picker still applies — the modal follows the pick. Save New Version asks nothing: its destination is the file it was asked on. | settled |
| I39  | Clicking the file name in the inspector renames it inline. A9 binds: the extension is never selected, and never shown while extensions are hidden.                                                                                                                               | settled |
| L37  | An unset document type shows BLANK — never "Unfiled" — in the cell and in the Details field alike. The field keeps its labelled, clickable footprint.                                                                                                                            | settled |
| I40  | The preview box fits its panel — the tall preview's fixed height had made its aspect ratio force the width past the screen edge. And an image file previews AS the image in the Preview tab, not as a page placeholder.                                                          | settled |

**Notes recorded this round:**

- I38 removes the finding sentence from Details; the byte-disagreement statement stays there
  because it is a TYPE fact — I10 ("say what the bytes actually read as") still binds.
- The document-type menu's "Add" item rendered the literal text "undefined" — `ICONS.plus` was
  referenced but never defined. Fixed in passing; no ruling needed, it was simply broken.

## R13 — round ten: thirty-four corrections in one sitting

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| L38  | A pinned item's pin renders FILLED wherever the pin state shows — the menu item, the row mark, the column-pin control. Same Lucide geometry; fill is the only difference.                                                                                                                                                                                                                                                                                                                                                                              | settled |
| A17  | Pinning does NOT close the menu that caused it: the item toggles in place (label and filled glyph), because pinning is applied to several rows in a row.                                                                                                                                                                                                                                                                                                                                                                                               | settled |
| L39  | A Scale control sits in the footer: a labelled, keyboard-operable slider (75–175%) scaling icon-view previews, list row height, row icons, and the file area's text.                                                                                                                                                                                                                                                                                                                                                                                   | settled |
| L40  | A computing aggregate renders its field IMMEDIATELY — visibly pending, never hidden — and fills in as values arrive, one folder at a time. Refines L12; folder rows now carry an aggregate safety chip too.                                                                                                                                                                                                                                                                                                                                            | settled |
| A18  | Files get a Convert flyout: quick converts per source kind plus "Convert With Options" — every entry Soon-disabled with its reason (the conversion engine). Kinds with no honest convert get no item.                                                                                                                                                                                                                                                                                                                                                  | settled |
| A15b | Undo and redo live in the FOOTER, away from Back/Forward/Up. Shortcuts unchanged. (The owner relocating round nine's A15 placement, not a regression.)                                                                                                                                                                                                                                                                                                                                                                                                 | settled |
| I41  | The placeholder tail ": details, safety history, and versions live here while the list stays in reach." is struck. "Select a file or folder." stands alone.                                                                                                                                                                                                                                                                                                                                                                                            | settled |
| L41  | Right-clicking the empty space beneath the rows opens the folder-level menu — New Folder, New Document, Upload, Paste, Select All — clearing the selection first (L22).                                                                                                                                                                                                                                                                                                                                                                                | settled |
| A19  | **Defect root-caused:** the menu advertised Ctrl C/X/V but no keyboard handler existed. Wired into the one keydown listener; Ctrl+C yields to a real text selection; paste acts where the menu's Paste acts.                                                                                                                                                                                                                                                                                                                                           | settled |
| N23  | The "Views" heading is removed — T2's precedent: the rows are self-describing and the separator rule stays. No replacement name earned its place.                                                                                                                                                                                                                                                                                                                                                                                                      | settled |
| A20  | A multi-selection menu speaks for the WHOLE selection. Recorded per action: Download/Copy/Cut/Pin/Delete/Re-run carry counts; Set Document Type scopes to the files; Colour/Icon scope to the folders (shared marks only when all agree); Open and Rename disabled with reasons (one-item gestures); Convert and Browse Inside omitted on multi; Delete disabled with reason when a non-empty folder is included; deleted-view Details disabled with reason on many; archive members carry the extraction menu.                                        | settled |
| T6e  | **Defect root-caused:** a hovered swatch turned white — the menu's generic hover wash outranked the swatch's background. A swatch hover keeps ITS COLOUR; the outline is the affordance.                                                                                                                                                                                                                                                                                                                                                               | settled |
| T6f  | The selected swatch's halo paints ABOVE its neighbours (raised stacking), never overpainted. T6c re-verified square as rendered: computed radius 0 — no regression found this round.                                                                                                                                                                                                                                                                                                                                                                   | settled |
| A21  | **Defect root-caused:** renaming `.pdf.exe` to `.pdf` bounced — the commit re-appended the protected extension over a deliberate edit. A9 clarified: it governs selection and display, never editability. Extensions SHOWN: what was typed stands (the extension column follows; the bytes' finding does not). Extensions HIDDEN: the stored extension reattaches — extension edits are made with extensions shown. Authoritative for the app's rename too, per the owner.                                                                             | settled |
| A22  | The folder-delete dialog: header fixed (**defect:** the `h2` sat outside any `header`, so the header padding rule never applied — same unclosed-header defect fixed in Restore and the acknowledgement dialog); WHICH files are affected is a collapsible list behind an honest count; options are keep-structure (default) / drop-the-structure (when subfolders exist) / cascade last; destination is up-one-level (default) / root / any folder via the shared A16 picker, which excludes the deleted subtree. Empty folders still delete silently. | settled |
| N22b | History rows lead to their documents: click reveals (browse selection + inspector, or Deleted Files for deleted items); right-click carries the actions that still apply, scoped to where the document is NOW (refs resolved at click time). Bulk operations write one row per document, so every affected document is reachable. Rows whose document is gone say so and offer nothing dead.                                                                                                                                                           | settled |
| S15  | **Defect root-caused:** "Open full results" overflowed the dropdown — its bottom-of-panel styling (full width, top border) survived S9's move onto the scope line. It now fits the line; "Search in" renders on ONE line; the panel is 380px.                                                                                                                                                                                                                                                                                                          | settled |
| S16  | The index status is WIRED: one ticking source feeds the dropdown label, its progress bar, and the results-page note; completion states itself instead of freezing at a stale percentage.                                                                                                                                                                                                                                                                                                                                                               | settled |
| S18  | No scope says "Everywhere": this control searches the matter and no wider (S1) — application-wide search is the top bar's job. The vocabulary is "Everything on this matter / Files only / This folder".                                                                                                                                                                                                                                                                                                                                               | settled |
| S17  | Search Results joins the views family: a rail row that appears while a search is live (an always-on empty row would be inert), marked current while open, breadcrumb titling the view (N21). Judgment recorded for correction.                                                                                                                                                                                                                                                                                                                         | settled |
| N24  | Rail spacing tightened: top padding and railhead at space-4, separator margins space-4 — the gap above Home and above the views group sits on the token rhythm, measured as rendered.                                                                                                                                                                                                                                                                                                                                                                  | settled |
| L42  | A live filter is unmissable: the filtered column's funnel fills (accent-subtle), every view's footer counts "x of y · filtered", a one-click "Clear N Filters" sits in the footer, and a filtered-empty list says WHY with the clear affordance in place.                                                                                                                                                                                                                                                                                              | settled |
| A24  | **P7 settled:** one "Open". Word-processing formats open the editor (a checkout is not a lock); everything else opens its Preview; a flagged file previews the withholding. The old "Open in Editor" item was ALSO inert — it had no handler. Double-click and Enter are the same gesture.                                                                                                                                                                                                                                                             | settled |
| D2   | **P3 settled:** restoring a file whose folder is gone ASKS at restore time — the A16-shaped picker, defaulting to the nearest surviving ancestor of the old path. Intact restores stay silent. A multi-restore asks ONCE: intact files go straight home; all orphans land together at the one chosen place (recorded). The x:902 fixture path was corrected to be genuinely orphaned.                                                                                                                                                                  | settled |
| F12  | Analysis severity vocabulary is Error / Warning / Info (Error = signature match, type mismatch; Warning = never scanned, no committed version; Info = no document type). The count chips ARE the band filters — click a count to narrow, item-19 active state — and the kind pills (P13) stay, properly spaced.                                                                                                                                                                                                                                        | settled |
| I42  | The clean verdict is the Lucide circle-check: circle filled with the success token, white check. Applied to the Safety column and folder aggregates. Folding the state into the file icon itself is recorded as P17, an owner question — not built.                                                                                                                                                                                                                                                                                                    | settled |
| A23  | **Defect:** Ctrl+A selected the page's text. It now selects every item on the VISIBLE surface (list rows or icon tiles); text fields keep native select-all.                                                                                                                                                                                                                                                                                                                                                                                           | settled |
| L43  | Arrow keys in both layouts: the icon grid is 2D (Left/Right step, Up/Down move by visual row); the list has no horizontal axis, so Left/Right also move down/up — never dead keys. Shift+arrow extends the range from the anchor (L8).                                                                                                                                                                                                                                                                                                                 | settled |
| I27d | **Defect root-caused:** Set Document Type opened at the far LEFT of the screen — the menu hid itself before the anchored dropdown measured its anchor, so the rect was zeros. It is now a flyout beside its menu item (the T6b pattern), filter-and-add inside (A11), capped and scrollable. Refines I27c's application in the menu; the Details-field dropdown (I27b) stays as is.                                                                                                                                                                    | settled |
| A25  | Cut, Copy, Paste are their own menu group, bounded by the menu's separator rule, in every menu that carries them.                                                                                                                                                                                                                                                                                                                                                                                                                                      | settled |
| F13  | The safety check can be RE-RUN: from the Safety tab, the right-click menu (counts on multi), and File Analysis rows. Append-only history — the request lands, then the scanner's words (I29, engine version per I23); a flagged file stays flagged; the oversize archive honestly stays unscanned; nothing is blocked. File-scoped by choice: a folder re-scan is recorded as a deliberate non-offer, not half-built recursion. The server pipeline exists, so nothing here needed a Soon.                                                             | settled |
| N25  | The breadcrumb Home button's hover box matches the toolbar buttons exactly: 30×30, same radius, same hover surface.                                                                                                                                                                                                                                                                                                                                                                                                                                    | settled |
| I43  | Versions are bare numbers — "12", never "v12" — in the Version column, version rows, tooltips, dialogs, and History's from/to. **Revises P9.** Where a bare number would dangle in prose, it reads "version 12". Scanner declarations in the safety history keep the scanner's own words (I29).                                                                                                                                                                                                                                                        | settled |
| L44  | A clear-filter affordance exists ONLY while a filter is in play — absence is the signal (recorded choice over disabling). The per-column menu's clear button appears the moment that column's filter engages and vanishes when it clears; the footer control was already presence-only.                                                                                                                                                                                                                                                                | settled |
| A26  | "Share" joins the file menu, Soon-disabled with its honest dependency: client-portal document sharing, which the build register carries as not started. Lucide share icon; multi-select composes ("Share 3 Files", still Soon).                                                                                                                                                                                                                                                                                                                        | settled |
| I44  | Timestamps render in the viewer's LOCAL time on every surface — History, Date Modified/Created/Deleted columns, version and safety histories, digest messages. Stored instants are UTC; the fixture's written-out stamps are parsed deterministically and formatted at render, exactly as the app will treat real data.                                                                                                                                                                                                                                | settled |

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
