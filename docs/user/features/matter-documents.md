# A matter's documents

_The documents screen is early. Uploading files and folders, saving new versions, folders, the
version history, and editing text documents all work today. Editing a Word document in the browser
opens a real editing session but needs the editor service running, so on some installations the
editor stays blank; the screen tells you when that is the case._

## What it does

Every document your firm holds for a matter lives on that matter's **Files** page. Open a matter and
choose **Files** from the row of sections under its title.

Each document keeps every version it has ever had. Saving a new one never replaces the old — the
previous version stays exactly as it was, and the record shows both.

## Adding a document

Choose **New File** at the top of the matter and pick one of its three items. **Upload Files** is
the way to bring files you already have; **New Document** builds one from a template; **New Folder**
makes a place to put them.

### Uploading files and folders

The Upload panel has two sides.

**On the right are your files.** Press **Add** and choose **Files**, or **A Folder, With Everything
Inside It**; or drag files and folders from your computer and drop them anywhere on that side. A
folder arrives with its contents, in the folders they came from, and you can add several folders
before you send anything. Fold a folder to hide what is inside it. Filter the list from its column
headers if there is a lot of it, and remove anything you did not mean to include with **Remove
Selected**. Nothing is sent until you press **Upload**.

**On the left is where they go and what they become.**

- **Matter** — the matter you are on, unless you choose another. Start typing a matter's name or
  number to find it.
- **Folder** — the folder you were looking at, the matter's Home, or any folder you pick from the
  tree. A folder you upload is recreated inside the one you choose.
- **Date Created** — whether each file keeps the date it already carries, or takes the date of the
  upload. Files keep their own date unless you say otherwise; that date is kept on the record either
  way, and shows in the file's details as **File's Own Date**.
- **Document Type** — a type to give every file in this upload, if your firm uses them.

Press **Upload**. The list on the right shows each file's progress, with how much of it has been
sent, and the bar above it measures the whole batch. You do not have to wait: close the panel and
carry on, because the upload keeps going. If you try to leave the screen with files chosen but not
yet sent, you are asked first, so a choice you spent time on is not lost by accident.

**Cancel Upload** stops a batch that is running. Files that have already landed stay on the matter;
the file being sent is given back; the rest read **Not sent**, and **Send the Rest** sends them
later. A large file (over your firm's limit for a single send, 100 MB unless it was changed) goes in
pieces behind the scenes; you see one upload, and a piece that stumbles is sent again on its own.

### Files you already have

Before a file is sent, Magna Carta reads it and asks whether your firm already holds exactly those
bytes. If the matter already has the file, its row reads **Already here** and nothing is sent. If
another of your firm's matters has it, the file is copied onto this matter without an upload, and
reads **Uploaded** as usual. So if a batch fails part-way and you send the same folder again, only
the files that did not land are sent. The read happens on your computer, a chunk at a time, with
the row reading **Reading** and the share done, so a file of any size is asked about before a byte
of it is sent.

### Watching an upload

The **upload button in the top bar**, beside the downloads button, marks itself while anything is
uploading. Press it to see each upload: how many files have landed, how many failed, and, once it
has finished, **Retry Failed** to send only the files that did not go, and **Open Folder** to see
the files where they landed. While it runs, the line under each upload reads the speed and about
how long is left. A running upload can be cancelled from here too. Clear finished uploads when you
no longer need to see them.

**Uploads** in the sidebar (add it from Customize if it is not there) shows every upload in full,
with the same list of files the panel showed, and the same controls. Uploads live in the browser
tab you started them in: the page shows this tab's uploads, and closing the tab ends them.

If you close the browser tab while files are still uploading, the browser asks before it goes;
files that had not finished would need to be uploaded again.

### If a file does not upload

Its row reads **Upload failed**, and pointing at it tells you why, with an Error ID you can quote to
support. The file is not added to the matter — a failed upload leaves nothing behind — and the rest
of the upload carries on.

### From a template

Choose **New Document**, pick a template, choose whether to build it as a Word document or a PDF,
and press **Build document**. Magna Carta fills in what the matter knows — its number, its client,
the date — and files the finished document onto the matter. If your firm has not registered any
templates yet the list says so; see [Document templates and assembly](document-templates-and-assembly.md)
for how templates are made.

Build it as a **Word document** while it is still being worked on, and as a **PDF** when it is going
out to be signed — a signature can only be applied to a PDF. A PDF is converted before it is filed, so
it takes a little longer; if that cannot be done the build fails rather than quietly giving you a Word
document instead.

### If the built document has blanks in it

After building from a template you may be told that some fields were left blank, or that some fields
are printing text left over from the template rather than a real value. Read the document before it
goes anywhere: it will look finished, and it is not. The message names the fields so you know where
to look.

## Reading the list

Each row shows the document's name, its status, which version it is on, its size, and when it last
changed.

The **status** column is worth reading:

- **Ready** — the document has been checked and can be opened.
- **Processing** — it has arrived and is being checked. It will become ready on its own; nothing is
  required of you.
- **Rejected** — the check refused it, and the reason is shown beside the label. It stays in the list
  deliberately, so a document that did not make it is visible rather than quietly missing. A rejected
  document has no readable content and cannot be opened.

## Opening a document

Select a document's row and the details panel describes it: its details, its preview, its versions,
its hashes, and its safety. **Open** is one gesture, and what it does depends on the document.
Double-click a row, press Enter on it, or choose **Open** from its right-click menu:

- A **Word document** (`.docx`, `.doc`, `.odt`, `.rtf`) opens in the browser editor, in a new tab.
- A **text document** (`.txt`, `.md`, `.log`, and other plain-text files such as `.json` or
  `.html`) opens in the text editor, in a new tab.
- A **folder** opens itself, and a **zip archive** opens to show what is inside it.
- **Everything else** opens its preview in the details panel. A document that is still being
  checked, one the check refused, or one with a safety finding open opens its preview too, where
  the panel says what is being held back and why; the editor never opens on a document the firm's
  checks have not cleared.

The tab the editor opens in is its own: leave it open while you go back to the file list, and open
several documents at once. The link at the top of the editor leads back to the matter's Files page
with the document selected.

## Saving a new version

In the panel, under **Save a new version**, drop the edited document in and press **Save new
version**. The returning file is checked the same way a new one is, and then kept as the next
version. The history above gains a row and the document's version number goes up.

If the check refuses the returning file, you are told, and the document's current version is left
untouched.

Saving a file whose contents are identical to the current version does not create a second version —
there is nothing new to keep.

## The version history

Every committed version of the document, newest first, with its number, its size, when it was
committed, and the start of its **content hash**. The hash is a fingerprint of the exact bytes: two
versions with the same hash are byte-for-byte the same file, and a version's hash never changes once
it is recorded.

## Editing in the browser

### Word documents

Opening a Word document starts a real editing session: the document is marked as being edited,
the fact that you opened it is recorded, and you are given time-limited access to that specific
version. The editor fills the tab. Saving inside it keeps the document's history the way any
other save does.

If a colleague holds the document under an exclusive lock, your tab opens **read-only** and says
so at the top. You can read along, including their live changes, but cannot take the lock from
them.

The editor itself runs as a separate service. Where that service is running, the document opens in
the tab. Where it is not, the frame stays blank: the session was opened, there is simply nothing
behind it yet. Until the editor is available everywhere, the reliable way to change a Word document
is to work on it in the application you normally use and then save it back with **Save New
Version** from the file's right-click menu.

### Text documents

A text document opens in a plain editor with the document's current text in it. Type your changes
and press **Save New Version** (or Ctrl+S, Cmd+S on a Mac). The status beside the button reads
**Unsaved changes** while there is something to save, then follows the save as it goes, and reads
**Saved as version N** when the new version is in the history. The previous version is never
replaced; every save is a new version alongside the ones before it.

If you try to close the tab or leave the page with unsaved changes, you are asked first.

A text document larger than the editor holds (a little over two million characters) does not open
for editing; the tab says so and offers a download instead. Edit it on your computer and save it
back as a new version.

### Who can edit, and who decides between two copies

- **Opening the editor, and taking a copy away to work on offline**, is available to the same people
  who can add a document in the first place: owners and administrators, attorneys, and paralegals.
  Typing a change and uploading a changed file are the same act, so they are the same permission.
- **Deciding between two copies that have both changed** is narrower — owners, administrators and
  attorneys. If you and a colleague both worked on the same document, somebody has to say which
  version the firm stands behind, and the one that is set aside is kept either way, so nothing is
  ever lost by that decision.
- **Releasing a lock somebody else is holding** sits with owners and administrators alone. You should
  rarely need it: a lock nobody is using is released on its own overnight, so a colleague on holiday
  does not leave a document stuck.

Everyone at the firm can still **read** a document, and watch it being edited, whatever their role —
reading is never blocked by somebody else having it open.

## Sample matters

Three matters exist purely so the matter screens can be looked at without any firm data behind them.
Open one and the Files page says it is a sample: it holds no documents, and nothing can be added to
it. Everything above applies to your firm's own matters.

## Related

- [Document templates and assembly](document-templates-and-assembly.md) — authoring and registering
  the templates the second creation path builds from.
- [File hash and integrity](file-hash-integrity.md) — what a content hash is and how to check one.
- [Filing email to a matter](filing-email-to-a-matter.md) — the other way documents reach a matter.
