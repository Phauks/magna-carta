# A matter's documents

_The documents screen is early. Adding, saving new versions, and the version history all work today.
Editing in the browser opens a real editing session but needs the editor service running, so on some
installations the editor panel stays blank; the screen tells you when that is the case. Folders,
renaming, and downloading arrive next._

## What it does

Every document your firm holds for a matter lives on that matter's **Files** page. Open a matter and
choose **Files** from the row of sections under its title.

Each document keeps every version it has ever had. Saving a new one never replaces the old — the
previous version stays exactly as it was, and the record shows both.

## Adding a document

Press **Add a document**. There are two ways.

**From a file you have.** Drag the document onto the panel, or press the button to pick it. Then
press **Add document**. It is sent to storage, checked, and appears in the list.

**From a template.** Choose **From a template**, pick one, and press **Build document**. Magna Carta
fills in what the matter knows — its number, its client, the date — and files the finished document
onto the matter. If your firm has not registered any templates yet the list says so; see
[Document templates and assembly](document-templates-and-assembly.md) for how templates are made.

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

Select a document's name. A panel opens below the list with everything about that one document.

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

Press **Open the editor**. This starts a real editing session on the document: it is marked as being
edited, the fact that you opened it is recorded, and you are given time-limited access to that
specific version.

The editor itself runs as a separate service. Where that service is running, the document opens in
the panel and in a new tab. Where it is not, the panel stays blank — the button worked, there is
simply nothing behind it yet. The screen carries a note saying so, so a blank panel is never a
mystery.

Until the editor is available everywhere, the reliable way to change a document is to work on it in
the application you normally use and then save it back with **Save a new version** above.

## Sample matters

Three matters exist purely so the matter screens can be looked at without any firm data behind them.
Open one and the Files page says it is a sample: it holds no documents, and nothing can be added to
it. Everything above applies to your firm's own matters.

## Related

- [Document templates and assembly](document-templates-and-assembly.md) — authoring and registering
  the templates the second creation path builds from.
- [File hash and integrity](file-hash-integrity.md) — what a content hash is and how to check one.
- [Filing email to a matter](filing-email-to-a-matter.md) — the other way documents reach a matter.
