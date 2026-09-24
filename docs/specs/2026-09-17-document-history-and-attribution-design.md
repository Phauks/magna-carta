# Document history — every save, who was there, and who wrote which words

**Status:** Layers 1 and 2 built (every save a version with its kind, the fold, participants per
version), 3.2 built (the firm policy, recording forced on by the host, the marks hidden on open),
and the accept-on-export step built (2026-09-24: the export copy, every download lane served from
it); 3.4 is design, the one decision (section 3.3) taken: accept on export. The owner asked on 2026-09-17 for history that matches
what Google Docs shows: every state of the document, grouped in a timeline, and each change
attributed to the person who made it, with the noise handled by grouping rather than by keeping
less.
**White paper:** _Documents & automation_ · _Delivery model_.
**Over:** [`2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md`](2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md),
which settled the working copy, the immutable version and the version cut at session end. This
spec settles what the version cut is FOR now that the browser editor is live, and adds the two
things a version alone cannot carry: who was in the document, and who wrote which words.

## What this settles

Three layers, in the order their answers depend on each other:

1. **Every save is a version, and history folds them.** Autosaves included.
2. **Who was there.** Every version records the members in the session when it was cut.
3. **Who wrote which words.** Attribution of individual changes, which only the document itself can
   carry, read into history and shown as a per-author diff.

Each ships on its own. The first two are small and land behind the round in flight; the third is the
work, and it turns on one decision stated in section 3.3 for the owner to confirm.

## What already exists, and is not the problem

- A version is immutable, hashed, sized, carries `uploaded_by` and `committed_at`, and history lists
  versions with restore. The version cut from the working copy (`commitEditedVersion`) already
  refuses to cut one whose bytes match the latest, so "keep every save" never means "keep the same
  bytes twice".
- The editor says on every save what kind of save it was: the member's own (`X-COOL-WOPI-IsAutosave`
  false), an autosave (true), or the save made as the last view leaves (`X-COOL-WOPI-IsExitSave`),
  and whether the member modified anything since the last one (`X-COOL-WOPI-IsModifiedByUser`).
  Since the round in flight, the member's own save and the exit save cut a version at once.
- The session Durable Object knows the participants of the live session, by member, and the editor
  reports every view joining and leaving to the page framing it.
- The editor labels every change, comment and cursor with the name the host sends
  (`UserFriendlyName`), and a document opened with recording on keeps every insertion and deletion
  with its author and time — the same mechanism Word calls Track Changes.

What is missing is entirely on the platform's side: autosaves are not kept, participants are
discarded when the session closes, and nothing reads the document's own record of who wrote what.

## 1 · Every save is a version, and history folds them

### 1.1 The cut

Every PutFile that carries modified bytes cuts a version: the member's own save, the exit save, and
the autosave. The `saveKind` the host already reads is stored on the version as
`file_version.save_kind` (`explicit` · `autosave` · `exit` · `upload` for versions that did not come
from the editor), so history can tell a named moment from the working copy keeping up. The hash
skip stays: an autosave that changed nothing cuts nothing.

The autosave cadence is the editor's, five minutes while something changed. A long session is
therefore a dozen versions an hour. That is the point: it is the timeline Google shows, and it costs
tens of kilobytes a version.

### 1.2 The fold

History shows the timeline grouped, newest first: **today**, then earlier days; inside a day, one
row per hour. An hour with one version is that version's row. An hour with several is one row
naming the span and the people, folded, with a disclosure that opens to the individual saves. A
member's own save and the exit save are never folded away: they sit at the top of their hour, named
("Saved by Ana", "Closed by Mira"), and the autosaves fold beneath. This is the owner's ruling that
noise is a filtering problem: nothing is dropped, and the default view is calm.

### 1.3 Restore

Restore is unchanged: a version becomes the current one by being cut forward, never by moving a
pointer back. The editor is told (`Host_VersionRestore`) so an open document reloads rather than
saving over the restored state.

## 2 · Who was there

When a version is cut from the working copy, the members of the live session are recorded against
it: `file_version_participant (version_id, member_user_id)`, from the session object's participant
set at that moment. History reads "Saved by Ana · also editing: Trevor, Mira". A version from an
upload has one participant, its uploader, and the table simply has one row.

This is the whole of the second layer, and it answers the owner's "by whom" for every version even
where the third layer has not run: it names everyone who could have written the words.

## 3 · Who wrote which words

### 3.1 The only attribution that exists

The editor hands the host the whole document on each save and no log of operations. The one record
of which person wrote which words lives inside the document, as tracked changes: each insertion and
deletion with an author and a time. Everything Google shows in its colour-by-author diff is
reconstructible from those marks, and nothing of it is reconstructible without them. Diffing two
versions' text attributes a change to a version, and to the participants of section 2, never to a
person when two were typing.

### 3.2 Recording on, showing off

Every document the firm opens in the editor records changes. The host does both halves of the
recording in one property: `DisableChangeTrackingRecord` is tri-state on the editor's side, and an
explicit `false` forces recording ON and takes the control out of the member's reach (an explicit
`true` forces it off the same way; absence leaves the document alone). So the host answers `false`
on every CheckFileInfo while the policy is on, and omits the property when it is off, which is the
firm stepping back rather than forbidding. The showing control stays available and starts off: the
launch carries the policy, and the page framing the editor sends `.uno:ShowTrackedChanges` false
once the document is showing, so the page a member types on looks the way it always did. A member
who wants to see the marks turns showing on, as in Word.

This is a firm policy, on by default, under Settings › Documents › Editing
(`firm:manageEditingPolicy`, Owner/Admin by seed), because a firm that files documents with
opposing counsel may decide otherwise and must be able to. Built 2026-09-18.

### 3.3 The decision: what happens to the marks

A document that records forever accumulates marks, and a copy leaving the firm would carry every
redline. Two answers; the owner chose the first on 2026-09-18 (decision fragment
`tracked-changes-are-accepted-on-export-never-in-storage`):

- **Accept on the way out.** The stored document keeps recording, so history and attribution stay
  complete for as long as the document lives. Any copy that leaves the platform — download, email,
  export, assembly output — is produced with all changes accepted, by the conversion container the
  platform already runs. A member never sends redlines they did not mean to.
- **Accept at each version cut.** The host reads the marks into history, then accepts them, so the
  stored file stays clean. Simpler files; but a member who turns showing on sees nothing older than
  the last save, and the attribution lives only in the platform's history.

Recorded as a pending decision (`docs/decisions/pending/tracked-changes-are-accepted-on-export-never-in-storage.md`).

**Built 2026-09-24, with one change to the means.** The decision named the conversion container
as what accepts the changes; the copy is produced instead by an XML rewrite of the package in
TypeScript (`acceptTrackedChanges` in `@magna-carta/document-assembly`), off the request path. The
office suite's headless save cannot accept changes without a macro, and re-rendering the document
would be a second answer to what it looks like — fonts, spacing, field results — where the copy
must be the member's document with the marks resolved and nothing else changed. The rewrite is
mechanical over the revision elements of WordprocessingML: insertions keep their content, deletions
go, a deleted paragraph mark joins the paragraph to the next (keeping the following mark, as Word
does), deleted rows and cells go, property-change records go, range markers go.

The copy is made once per version the editor cuts (`export_copy_state`, `export_r2_key`,
`export_size_bytes` on `file_version`), stored beside the version, and every download lane is
served from it: the per-file redirect and every lane of the bulk download. A copy not yet made at
the moment of a download is made on the spot; a document past the pass's caps is recorded
`unavailable` and downloads as stored, with the audit saying so — the one case chosen over refusing
a member their own document. The enumeration of outbound paths, what is deliberately not one, and
what must join the list when built, is kept in `apps/api-worker/src/editing/CLAUDE.md`.

Scope: versions the editor cut, in `.docx`. An uploaded document is served as it arrived — the
platform recorded nothing in it, and a redlined document from the other side is downloaded with
their redlines, which is what a member forwarding it expects. A document the editor cut from such
an upload has the other side's marks accepted along with the firm's own on the way out; that is the
decision's consequence, and the stored version keeps both.

### 3.4 Reading the marks into history

At every version cut, the host reads the version's change marks — author, time, kind, the text
inserted or deleted, and where — into `file_version_change`, one row per mark, keyed to the version
and to the member the author name resolves to. The reader is Rust in the shared document core
(word-processing documents are zipped XML; the marks are `w:ins` and `w:del` elements with
`w:author` and `w:date`), compiled to WASM for the worker as the other document readers are. Only
the marks are read; the platform never holds the document's text outside object storage.

A mark carries the author's name as text, not a member identifier — that is what the document
format holds — so the reader resolves the name to a member at the moment of the cut, against the
session's participants first (two members sharing a display name are told apart by who was in the
document) and the firm's roster second. The change row then carries the member's identifier, so a
member's later renames follow them in history, and a mark whose name resolves to nobody is kept
with the name it carries rather than dropped.

History then shows, for any version or fold, the per-author summary ("Ana: 3 paragraphs added, 2
sentences removed · Trevor: 1 sentence changed") and, on opening it, the diff coloured by author,
rendered from the marks rather than from a text comparison.

### 3.5 What is deliberately out

Spreadsheets and presentations record no per-cell or per-shape authorship in their formats; for
them the first two layers are the whole of history, and the diff view says so rather than
pretending.

## Test plan

- A PutFile of each save kind cuts a version with that kind; an unchanged PutFile cuts none.
- The fold: an hour with one version is one row; an hour with four is one folded row whose
  disclosure lists four; a member's own save is never folded.
- Participants: a version cut during a two-member session carries both; an upload carries one.
- Recording: a document opened under the policy records; a document opened with the policy off does
  not; the recording control is absent from the editor under the policy.
- Marks: a version with two authors' changes yields rows for both, attributed to the right members;
  a version with none yields none; a spreadsheet yields none and history says why.
- Accept on the way out: a download of a recording document carries no marks; the stored version
  still does.

## Order of build

1. `save_kind` on the version, the autosave cut, and the folded history — layer 1.
2. Participants per version — layer 2.
3. The firm policy and recording-on-load — 3.2.
4. The owner's answer to 3.3, recorded; accept-on-export — built 2026-09-24, as an XML rewrite.
5. The mark reader in the document core, the change rows, the per-author summary and diff — 3.4.
