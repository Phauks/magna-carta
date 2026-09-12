# A matter's documents

_The documents screen is early. Uploading files and folders, saving new versions, folders, the
version history, reading PDFs, and editing text documents all work today. Editing a Word document in
the browser opens a real editing session but needs the editor service running, so on some
installations the editor stays blank; the screen tells you when that is the case._

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

**On the right are your files.** Press **Add** to choose files. For a folder, use the small arrow
beside Add and choose **A Folder, With Everything Inside It** — a browser will not let one picker
offer files and folders together. Dragging has no such limit: drop any mix of files and folders from
your computer anywhere on that side of the panel. A folder arrives with its contents, in the folders
they came from, and you can add several folders before you send anything. Fold a folder to hide what
is inside it. Nothing is sent until you press **Upload**.

The list is the same table you use everywhere else in Magna Carta. Click a column heading to sort by
it — folders stay with the files inside them, so a sort still reads as the tree it is. Right-click a
heading to filter on that column, to hide it, or to bring back one that is hidden; filtering flattens
the list to the files that match, with a **Folder** column saying where each one sits. When something
is filtered, **Clear Filters** appears above the list, and the strip underneath says how many of your
files you are looking at. Remove anything you did not mean to include with **Remove Selected**.

**On the left is where they go and what they become.**

- **Matter** — the matter you are on, unless you choose another. Start typing a matter's name or
  number to find it.
- **Folder** — the folder you were looking at, the matter's Home, or any folder you pick from the
  tree. A folder you upload is recreated inside the one you choose.
  **Advanced Settings**, at the foot of that side, is folded shut and holds the three answers most
  uploads never need to change:

- **Date Created** — whether each file keeps the date it already carries, or takes the date of the
  upload. Files keep their own date unless you say otherwise; that date is kept on the record either
  way, and shows in the file's details as **Source File Date**: the last-modified date the file
  carried on the device it came from, as distinct from **Date Created**, which is when the record
  was made here.
- **Files the Firm Already Holds** — whether a file your firm already has is sent again, or copied
  into place without sending. Copied, by default; see _Files you already have_ below.
- **When a Name Is Already Taken** — what happens to a file whose name is already in the folder it
  lands in: kept beside the other under a numbered name (the default), filed as the next version of
  the file that has the name, or skipped. See _When a name is taken_ below.

**A document type is set per file, not for the whole upload.** If your firm uses document types,
select the rows you want — a folder row means everything inside it — and choose **Document Type**
above the list. The **Document Type** column shows what each file will carry, so one upload can file
correspondence as correspondence and pleadings as pleadings without sending them separately.

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
bytes. If it does — on this matter or on another — the file is copied into place without an upload,
and its row reads **Uploaded** as usual, with a note saying where the copy came from. It is still a
file of its own: choosing to upload it means you wanted it there, and holding the same bytes
elsewhere is only a reason not to send them over the wire again. So two identical files you chose
both arrive, and a file you upload twice is there twice. The read happens on your computer, a chunk
at a time, with the row reading **Reading** and the share done, so a file of any size is asked about
before a byte of it is sent.

### When a name is taken

A file whose name is already in the folder it lands in asks one question, and only that one: what
to call it. By default it is kept beside the other under a numbered name — _letter (2).pdf_ — so
nothing is lost and nothing is asked later. Under Advanced Settings you can instead have every such
file filed as the next **version** of the file that has the name (the original stays in its
history), or **skipped** and left out of the upload. The **Name Taken** column shows which files are
asking and what the answer is; to answer some of them differently, select their rows and choose
**Name Taken** above the list. A file skipped this way reads **Skipped**, sends nothing, and is not
read.

Two files in the same batch that share a name are filed as numbered copies without asking — there is
no existing file to make a version of.

**Reading starts as soon as you choose a file**, while you are still deciding where it goes, so by
the time you press **Upload** most of the answers are already in and nothing waits on a read that
could have happened earlier. If you would rather send everything regardless of what your firm holds,
turn **Files the Firm Already Holds** to **Send Every File** under Advanced Settings; no reading is
then done at all.

### Watching an upload

The **upload button in the top bar**, beside the downloads button, marks itself while anything is
uploading. Press it to see each upload: how many files have landed, how many failed, and, once it
has finished, **Retry Failed** to send only the files that did not go, and **Open Folder** to see
the files where they landed. While it runs, the line under each upload reads the speed and about
how long is left. A running upload can be cancelled from here too. Clear finished uploads when you
no longer need to see them.

The **upload icon at the far end of the row at the foot of the sidebar**, beside Downloads, shows
every upload in full, with the same list of files the panel showed, and the same controls. Uploads live in the browser
tab you started them in: the page shows this tab's uploads, and closing the tab ends them.

If you close the browser tab while files are still uploading, the browser asks before it goes;
files that had not finished would need to be uploaded again.

### If a file does not upload

Its row reads **Upload failed**, and pointing at it tells you why, with an Error ID you can quote to
support. The file is not added to the matter — a failed upload leaves nothing behind — and the rest
of the upload carries on.

If the reason says **the firm's storage did not answer**, the fault is not with your file, your
matter, or your connection to Magna Carta — the rest of the application is plainly still answering.
Files go from your browser straight to your firm's storage, and that route is the one that failed.
Try again; if it keeps happening, quote that message to whoever administers your firm's Magna Carta,
because it is settled there rather than by anything you can do from this screen.

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

### Where you are in the folders

The strip above the list is the path to the folder you are in, starting at the home icon. Home is
always there, beside the back, forward and up buttons, so the top of the matter is one press away
however deep you have gone.

A path too long for the strip folds its middle away behind an ellipsis (**…**). The folder you are
in, the one it sits in, and the first folder under Home stay visible; pressing the ellipsis lists the
folders it stands for, and choosing one opens it.

## Opening a document

Select a document's row and the details panel describes it: its details, its preview, its versions,
its hashes, and its safety. **Open** is one gesture, and what it does depends on the document.
Double-click a row, press Enter on it, or choose **Open** from its right-click menu:

- A **Word document** (`.docx`, `.doc`, `.odt`, `.rtf`) opens in the browser editor, in a new tab.
- A **text document** (`.txt`, `.md`, `.log`, and other plain-text files such as `.json` or
  `.html`) opens in the text editor, in a new tab.
- A **PDF** opens in the reader, in a new tab.
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

Every committed version of the document, newest first, as a table: its number, when it was
committed, its size, and who created it. Each row has its own controls: open that version, or
verify it, which opens the **Hashes** tab on that version.

## Hashes

The **Hashes** tab computes the document's five fingerprints the moment you open it, from the bytes
as they are stored today, and compares the SHA-256 to the one recorded when the version came in. A
hash is a fingerprint of the exact bytes: two versions with the same hash are byte-for-byte the same
file, and a version's hash never changes once it is recorded. The dropdown at the top picks which
version the fingerprints are of; the current version is chosen until you change it, and choosing
another computes its fingerprints straight away. The refresh control computes them again.

Under the fingerprints, **Compare Against a Digest You Were Given** takes a digest from anywhere:
type it, paste it (a whole checksum line, with the file name after it, is fine), or pick a file on
your own device and its SHA-256 is computed there and never sent. Which of the five fingerprints
it is comes from its length, so you need not say. The result reads **Match** or **Mismatch**
against that fingerprint of the version on screen.

## Safety

The **Safety** tab shows the document's standing verdict, and beneath it every check the document
has had: when it ran, whether it was the check at intake or a later one, which version it looked
at, the engine that ran it, what it found, and the engine's own detail. Each line says what was
recorded at the time, so an older check keeps the engine that ran it even after the firm moves to a
newer one; the line under the table names the engine the firm checks with today.

**Check Again** asks for a fresh check of the current version. The request appears in the history
at once, marked as requested, and the verdict lands beneath it a few seconds later without your
asking. The same request is on a document's right-click menu as **Re-run Safety Check**, where it
runs on every selected document that has a version to check.

## Archives

Open a zip, a tar, a 7z or a rar and it shows what is inside it, folder by folder, without
unpacking anything or downloading it. The bar above the list names the archive you are in; use the
crumbs to move through its folders, and close it to return to the matter's own files.

What the archive is called does not decide this — its actual contents do. An archive somebody sent
you under the wrong name still opens, and a file named `.zip` that is not one is told to you as
what it is.

A very large archive lists as quickly as a small one. Only the part of the file that records what is
inside it is ever read.

Two archives will not open their lists. One whose list of files is itself password-protected —
possible with 7z, which can lock the names as well as the contents — cannot be shown without that
password. One packed in a way the application does not read is named as that rather than reported as
broken. Both can still be downloaded.

### Taking files out

Files can be taken out of a **zip**, a **tar** and a **7z**. A **rar** can be looked inside but not
unpacked here — the control says so rather than being offered and then refusing — so download a rar
to open it.

Select what you want and choose **Extract**, or choose **Extract Into This Matter** with nothing
selected to take out everything in the archive. Files land in the folder the archive itself sits in.

Each extracted file is checked on the way in exactly like a file you upload: it is scanned, its type
is read from its actual contents rather than from its name inside the archive, and it becomes an
ordinary document on the matter with its own version history. Extracting never changes the archive,
which stays on the matter as it was.

Some members will not come out, and the screen names the reason rather than only counting them:

- **Password-protected inside the archive.** Magna Carta holds no password for it. A 7z can lock its
  files one at a time, so some members of one archive may come out while others do not.
- **Packed in a way the application cannot open.** Most archives use a form it reads; a few do not.
- **Not a file.** Some archives carry entries that are shortcuts to somewhere else, or devices,
  rather than content. There is nothing in them to take out.
- **Its contents do not match what the archive recorded.** The zip's own checksum for that file
  disagrees with the file itself, which is what a damaged or altered member looks like. It is
  refused rather than filed.
- **Too large, or it expands far enough to be treated as unsafe.** Your firm sets both limits.

The rest of the selection still arrives. If nothing comes out at all, you are told why that was.

## Reading a PDF

Open a PDF and it appears in a new tab, a page at a time. Scroll to move through it; the toolbar
says which page you are on and how many there are. **Plus** and **minus** change the zoom, and
**Download** saves the file if you would rather work on it elsewhere.

The document is drawn by Magna Carta itself rather than handed to the browser's own PDF viewer.
Pages are drawn as you reach them, so a long document opens straight away instead of making you wait
for the end of it.

Some PDFs will not open. One that is larger than the reader holds, one whose contents cannot be
read, and one built in a way that is unsafe to open all say so on the screen and offer you the
download instead. The file is stored either way, and nothing about it is changed by trying.

A password-protected PDF asks for its password right there instead of failing outright — type it
and the document opens normally. The password is checked in this browser and never sent anywhere.
If you do not have it, the reader points you to File Unlock & Password Recovery in Tools, which can
search for a common or predictable one.

A PDF is read-only here. There is no editing, and nothing you do in the reader changes the document
or adds a version.

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

Two kinds of text document do not open for editing, and each says so and offers you the download
instead. One is a document larger than the editor holds, a little over two million characters. The
other is a document written in an older character set, which happens with files carrying curly
quotes, dashes or accented names that came from an earlier system: opening it would show some of
those characters wrongly, and saving would store them that way, so the editor stands aside rather
than risk the document. Edit either one on your computer and save it back as a new version.

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
