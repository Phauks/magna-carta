# A matter's documents

_The documents screen is early. Uploading files and folders, saving new versions, folders, the
version history, reading PDFs, watching videos, and editing text documents all work today. Editing a Word document in
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

**On the right are your files.** Press **Add** and choose **File** or **Folder** — a browser will
not let one picker offer files and folders together, so they are two choices. Dragging has no such
limit: drop any mix of files and folders from your computer anywhere on that side of the panel. A
folder arrives with its contents, in the folders they came from, and you can add several folders
before you send anything. Fold a folder to hide what is inside it. Nothing is sent until you press
**Upload**.

The panel opens at one size and keeps it. Switching tabs on the left, adding a folder, or unfolding
one never moves what you were looking at; whichever side has more than fits scrolls inside its own
space.

The list is the same table you use everywhere else in Magna Carta. Click a column heading to sort by
it — folders stay with the files inside them, so a sort still reads as the tree it is. Right-click a
heading to filter on that column, to hide it, or to bring back one that is hidden; filtering flattens
the list to the files that match, with a **Folder** column saying where each one sits. When something
is filtered, **Clear Filters** appears above the list, and the strip underneath says how many of your
files you are looking at. Remove anything you did not mean to include with **Remove Selected**.

**On the left is where they go and what they become**, in two tabs. **Location** is what every
upload decides:

- **Matter** — the matter you are on, unless you choose another. Start typing a matter's name or
  number to find it.
- **Folder** — the folder you were looking at, the matter's Home, or any folder you pick from the
  tree. A folder you upload is recreated inside the one you choose.

**Advanced Settings** holds what most uploads never need to change:

- **Date Created** — whether each file keeps the date it already carries, or takes the date of the
  upload. Files keep their own date unless you say otherwise; that date is kept on the record either
  way, and shows in the file's details as **File's Own Date**.
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

### Whether each file is ready, and files you already have

As soon as you choose a file, Magna Carta reads it on your computer, a chunk at a time, and asks
whether your firm already holds exactly those bytes. The **Status** column says where each file
stands before you press anything: **Reading** with the share done while it is read, then **Ready**
once it is, or **Held** if your firm already has a file with those bytes, or **Not read** if the
file could not be read here (it is sent as it is). A folder row sums its files: "2 of 3 ready ·
1 held". By the time you press **Upload** most of the answers are already in, and nothing waits on a
read that could have happened earlier.

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

A held file is never sent. If the matter already has it, its row reads **Already here** once the
upload runs and nothing is made; if another of your firm's matters has it, the file is copied onto
this matter without an upload and reads **Uploaded** as usual. So if a batch fails part-way and you
send the same folder again, only the files that did not land are sent. There is no setting for
this: a file your firm holds is simply never uploaded twice. Deleting one copy of such a file never
removes the stored bytes while any other file, even a deleted one, still holds them.

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

Its row reads **Upload failed**, and a line under the file's name says what failed: the reason the
server gave, or which part of the route did not answer. Pointing at it gives the whole account, with
an Error ID you can quote to support. The uploads tray in the top bar names the failed files and
what failed under the upload they belong to. The file is not added to the matter — a failed upload
leaves nothing behind — and the rest of the upload carries on.

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

The list is the only part of the screen that scrolls. The matter's title and its row of sections,
the folder path, and the counts strip along the bottom all stay where they are however long the list
gets, so you can scroll a folder of two thousand documents and still reach everything around it.

### What the icon beside a name means

The icon and its small label (PDF, DOCX, XLSX) read the document's own name — the part after the
last dot — the same as the **File Type** column does. Rename a Word document to end in `.pdf` and
its icon becomes a PDF icon; give it an ending nothing recognizes and it becomes a plain blank sheet
with no label. The icon tells you what the name says the document is.

Whether the name is telling the truth is a separate check, and it is made for you. Every document's
contents are read on the way in, and when they are not what the name says — a Word document called
`.pdf`, a photo called `.docx`, a document whose ending nothing recognizes — the row's **Safety**
reads **Error** and the matter's File Analysis lists it as a **Type Mismatch**. The icon does not
quietly correct the name for you, because a name that lies about a file is something you should be
told, not something the screen should paper over.

Opening a document always goes by its contents, not its name: a Word document renamed to `.txt`
still opens in the Word editor.

### As icons instead of rows

The switch on the right of the strip above the list swaps the rows for tiles. A name too long for a
tile runs onto a second and a third line and then stops with an ellipsis; the whole name is on the
tile's hover either way, and no tile ever covers the one beside it.

### Making the list bigger or smaller

The two magnifier buttons on the counts strip, with a percentage between them, scale the file area
from half size to double. They work the same in both views: as tiles they size the tiles, and as
rows they size the list's text, the height of its rows and the icons beside the names. Everything
around the list — the folder path above it, the strip the buttons themselves sit on — stays put, so
scaling up shows you more of the list rather than less of the screen. The setting is remembered.

### Moving something into a folder

Drag a file or a folder onto the folder you want it in. This works wherever the screen shows you a
folder: a folder in the left sidebar, a folder row or tile in the list itself, and any crumb in the
path above the list — which is how something comes back **out** of a folder, since every folder
above where you are standing is already on that strip. Dropping on the home icon moves it to the top
of the matter.

Select several rows first and dragging any one of them carries the whole selection; what you are
holding says how many.

The cursor tells you before you let go. It says no over a folder that already holds the thing, over
a folder you are dragging into itself or into something inside it, and over anything that is not a
folder. If you have several things selected and only some of them can go where you are pointing,
those are the ones that move.

Dragging is the fast way, not the only way: **Cut** and **Paste** on the right-click menu (or
Ctrl+X and Ctrl+V) make the same move without a pointer, and they reach the folders in the left
sidebar too. Either way, the move goes on the undo stack.

Dropping files in from your computer is a different thing and still starts an upload — the screen
tells the two apart by what is being carried, not by where you drop it.

### Taking something back

The arrows at the bottom of the screen undo and redo. They cover renaming, moving a file or folder
between folders, pasting a cut, deleting a file, and pinning — and each says what it will take back,
so **Undo renaming Motion.pdf to Answer.pdf** is what you read before you press it. The small arrow
beside each one opens the list of recent changes, so you can walk back several at once.

Two things are outside them. Deleting a **folder** cannot be undone; when you delete one, the screen
says so and points you at **Deleted Files**, where the documents it held can still be brought back
one by one. And undo does not survive a reload: it is for the change you just made.

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

- An **office document** — a Word document (`.docx`, `.doc`, `.odt`, `.rtf`), a spreadsheet
  (`.xlsx`, `.xls`, `.ods`, `.csv`), a presentation (`.pptx`, `.ppt`, `.odp`) or a drawing — opens
  in the browser editor, in a new tab. The full list of formats, older ones included, is under
  **Settings › Documents › Opening Files**.
- A **text document** (`.txt`, `.md`, `.log`, and other plain-text files such as `.json` or
  `.html`) opens in the text editor, in a new tab.
- A **PDF** opens in the reader, in a new tab.
- A **video** (`.mp4`, `.mov`, `.webm`, and other recordings) opens in the player, in a new tab.
- A **folder** opens itself, and a **zip archive** opens to show what is inside it.
- **Everything else** opens its preview in the details panel. A document that is still being
  checked, one the check refused, or one with a safety finding open opens its preview too, where
  the panel says what is being held back and why; the editor never opens on a document the firm's
  checks have not cleared.

The tab the editor opens in is its own: leave it open while you go back to the file list, and open
several documents at once. The editor fills that tab. To return to the matter's files, use the
first button on the editor's bar, the arrow with the matter's number beside it (or the word
"Matter", for a matter that has no number yet). A long number is cut short with an ellipsis;
resting the pointer on the button shows the whole of it. It saves first and then takes you back with the
document selected; closing the document from the editor's own menu does the same.

The editor's **Help › About** names the editor's own versions and, beneath them, the Magna Carta
build serving the document, which is what to quote when reporting a problem from inside the
editor.

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

For a Word document edited in the browser with recording on, each version also says **who changed
what** in it: "Ana Vasquez: 3 added, 2 removed · Trevor Goldsmith: 1 reformatted". That comes from
the document's own record of changes, so it names the person who typed the words, not just the
person who pressed Save. Open a version's changes and the words appear in order, each with its
author: additions underlined, removals struck through, a formatting change marked as such. A version
lists only what is new in it; what an earlier version already showed is not repeated. The record is
read when the version is saved, so a version saved a moment ago may say nothing for a few seconds.
Uploaded documents, spreadsheets and presentations carry no such record, and their versions say
nothing here.

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
at, the engine that ran it, what it found, and the detail behind that. Each line says what was
recorded at the time, so an older check keeps the engine that ran it even after the firm moves to a
newer one.

The **Detail** column carries the scanner's own words exactly as they were recorded — a rule name, a
signature name — so that what you read is what the engine wrote. Where the platform itself wrote the
detail rather than the engine, it is stated plainly instead: that the document holds active content
(macros or embedded scripts), that it was encrypted and so could not be read, or that no engine was
reporting and nothing was checked.

**Check Again** asks for a fresh check of the current version. The request appears in the history
at once, marked as requested, and the verdict lands beneath it a few seconds later without your
asking. The same request is on a document's right-click menu as **Re-run Safety Check**, where it
runs on every selected document that has a version to check. If a request could not be sent to the
engine, its line says **Not queued** rather than leaving you waiting for a verdict that is not
coming, and the detail beside it says why.

### What the check ran under

Beneath the history, the tab states what a check on this matter is made of, so a verdict can be
audited rather than taken on trust:

- **Engine**, **YARA ruleset** and **Malware definitions** — the three parts of the engine the firm
  checks with today, as the engine reports itself.
- **Scan Depth**, **Suspicion Threshold**, **Flagged Files** and **Confirm Identity First** — the
  firm's own file-safety settings. They are the same four settings an administrator sets under
  Settings; see [File safety and scanning](../admin/file-safety-and-scanning.md).

The last line says which of these is recorded per check and which is not. Only the **engine** is
recorded against each line of the history. The depth, the threshold and the treatment are the firm's
as they stand today: if somebody changed one of them after a check ran, nothing records what that
check actually ran under.

## Renaming a document or a folder

Press the name at the top of the details panel and it becomes a field, in the panel, holding the
name you were reading. Type, then press **Enter** to keep it, **Escape** to leave it as it was.
Clicking away keeps it too, because a name you typed and then clicked away from is a name you meant.

If the name cannot be used — because another document or folder here already has it — the field
stays open with what you typed and the reason beneath it, and the record keeps the name it had until
you give it one that works.

Renaming a row in the list itself works the same way: press **F2**, or choose **Rename** from the
row's right-click menu.

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
If you do not have it, the reader points you to the File Workbench's Unlock tab, which can
search for a common or predictable one.

A PDF is read-only here. There is no editing, and nothing you do in the reader changes the document
or adds a version.

## Watching a video

Open a video and it plays in a new tab, with the controls in a bar beneath the picture so they never
cover it. Select a video's row and its **Preview** tab in the details panel plays it there too, with
a smaller set of controls.

The bar holds the time and a seek bar across the top, and beneath them: play and pause, a step back
and forward of one frame, a jump back and forward of ten seconds, sound, the playback speed (half
speed up to double), picture in picture where the browser offers it, and full screen. With the
player selected, the keyboard does the same: **K** plays and pauses, **J** and **L** jump ten
seconds, **,** and **.** step a frame, **M** mutes and **F** goes full screen.

**Copy Link at** copies an address that opens the video at the moment shown, so you can send a
colleague straight to the part of a deposition you mean.

Videos in MP4, MOV, WebM and MKV files play when the browser you are using can decode them. Video
recorded in HEVC, as many phones record it, plays in Safari, in Edge and in Chrome on most newer
computers; Firefox and older computers may not play it. If your browser cannot play a video, the
player says so and offers the download instead, so you can watch it in a video application or
open it in another browser.

A few formats no browser decodes, such as ProRes video, older Windows Media and MPEG-2 files, and
Dolby Digital sound. Magna Carta reads how each video is encoded the first time anyone opens it, and
one of these says so straight away and offers the download. The file is stored either way, and
nothing about it is changed by trying.

A video is read-only here. Nothing you do in the player changes it or adds a version.

## Editing in the browser

### Office documents

Opening a Word document, a spreadsheet or a presentation starts a real editing session: the
document is marked as being edited, the fact that you opened it is recorded, and you are given
time-limited access to that specific version. The editor fills the tab. Saving inside it keeps the
document's history the way any other save does. Several members can edit the same document at
once; each sees the others' changes as they are made.

Every save in the editor becomes a version in the file's history: the ones you make with Save,
the one made when the last person closes the document, and the editor's own autosaves every few
minutes. **Version History** shows the named saves and folds the autosaves behind one line that
says how many there are; **Show every save** opens them. Each version names who saved it and
everyone else who had the document open at the time.

Unless your firm has decided otherwise, every document you open in the editor records who changed
what, from the first edit, and the control for turning that off is not offered. The marks are
hidden, so the page reads and types the way it always did; to see them, open the editor's
**Review** tab and turn **Show Track Changes** on. What that setting is and who decides it:
[Editing](../admin/editing.md).

A document that records its changes keeps that record for as long as it lives. **A copy that
leaves the platform does not carry it.** Downloading the document, or a bundle that holds it, hands
out a copy with every change accepted, so what goes to the other side reads as the finished text
and shows nobody's edits. The stored document is untouched; open it in the editor and turn **Show
Track Changes** on, and the whole record is still there. The copy is made moments after each save;
if you download in that same moment, the download waits for it, and a bundle of several documents
saved that instant may ask you to try again shortly. The one exception is a document too large
for the copy to be made: it downloads as stored, and the firm's audit trail records that it did.

While the document opens, the screen tells the open as it happens: each stage appears as it
finishes, with the moment it did, and the stage under way says what it is doing and why it takes
the time it takes. A bar fills over the half minute an open usually takes, and says so; past that
it says the open is running long, and after forty-five seconds it offers **Retry**. A first open
takes most of that half minute, because the editor starts for that document on demand. Each
stage's time is its own, so the slow one is the one with the big number. **Show details** opens
the log of what actually happened, in order and on every side: the editor's container being asked
for, running and answering; the editor asking for the document's details and its contents and
what it was told; the page loading and the document appearing. If the open stops, the screen says
at which stage, and the details beneath the message are what to send to support.

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
