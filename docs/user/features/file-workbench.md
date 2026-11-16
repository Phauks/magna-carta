# File Workbench

One place to bring a file that is not attached to any matter, and find out everything about it at once.

## What it does

You are sent a file and you have a question about it. Is this really a PDF, or is it something else wearing a PDF's name? Does it match the hash opposing counsel quoted? What is hidden in its properties? Can it be turned into something a court will accept? Is it safe to open at all?

Those used to be separate tools. They are one screen now. Drop a file on the workbench and it is read straight away; everything the firm can do to a file is a tab beside it.

Nothing here is filed. A file on the workbench does not belong to a matter, does not appear in any matter's documents, and leaves no record of having been looked at. It is a bench, not a filing cabinet. When you are finished, **Discard All** clears it, and closing the page clears it too.

## What it can tell you

Some of this is read the moment a file lands, without being asked, because it is quick and changes nothing:

- **Type** — what the file actually is, read from its own first bytes rather than from its name, and whether the name agrees. A file called `invoice.pdf` whose contents are a Windows program is named on this tab, in those words.
- **Hash** — the file's fingerprints, and a box to paste in a fingerprint somebody sent you so you can see at a glance whether they match.
- **Malware Scan** — what the scanner made of it, and what in the file can act on its own: scripts, macros, actions that run when it opens, embedded objects, links it fetches without asking. A disarmed copy with all of that taken out is one click away.
- **Metadata** — the properties a document carries that nobody typed on purpose: the author, the firm, the revision count, a scanner's model number.
- **Email** — for a saved message, its headers, the route it took, and what it carried, and a copy of it as a PDF.

The rest wait until you ask, because each one either writes a new file, costs money, or sends something outside the firm:

- **Convert** — turn the file into another format. The original is never replaced.
- **Repair** — read what can still be read out of a damaged file, working on a copy.
- **Text Recognition** — get selectable text out of a scan or a photograph of a page.
- **Unlock** — open a protected document you have the password for.
- **AI Text** — an estimate of whether a passage was written by a machine. This is the one thing on the workbench that sends content outside the firm, so it asks every time, for each file separately.

## A file that fails a scan still gets read

If the scanner flags a file, the workbench says so and carries on. Every tab still works on it.

That is deliberate. A file you are unsure about is the whole reason to bring it here rather than open it on your desktop, and the things that would tell you what you are actually dealing with are exactly the readings a warning screen would take away. So you get the warning **and** you get the answers: what it really is, what it hashes to, what the scanner matched. Nothing is opened or run; the workbench reads files, it does not execute them.

## Common tasks

**Check that a file is what it claims to be**

1. Open **File Workbench** in the sidebar, under **Firm**.
2. Drop the file anywhere on the list at the left, or use **Add Files** at the top right.
3. Open the **Type** tab. It says what the bytes read as, what the name claims, and whether the two agree.

**Confirm a file matches a hash you were given**

1. Drop the file on the workbench and open the **Hash** tab.
2. Paste the fingerprint you were sent into **Paste a digest to compare**.
3. It tells you whether it matches. Upper or lower case and stray spaces make no difference.

**Convert several files at once**

1. Drop all of them on the workbench.
2. Select them: click the first, then shift-click the last for a run of files, or hold Ctrl (Cmd on a Mac) and click to pick out individual ones. The bar under the list says how many files there are and how many are selected.
3. Open the **Convert** tab. It offers only the formats **every** selected file can become, so a conversion cannot fail halfway through. If a format you expected is missing, one of the files in the selection cannot reach it; narrow the selection and it comes back.
4. Press the format. Each file is sent to the firm's conversion engine in turn, and the table lists how each one went. A converted copy can be saved, or put on the bench beside the original; with several, **Put All on the Bench** takes every copy at once. The originals are never changed.

**Read a saved email and keep it as a PDF**

1. Drop the `.eml` or `.msg` file on the workbench and open the **Email** tab.
2. **Message** shows who sent it, to whom, when, and whether the sending domain signed it. **Route, Oldest First** lists the mail servers it passed through, starting with the one it left from.
3. Each attachment has **Open in Workbench**, which puts it on the list as a file of its own so every other tab can read it, and a save button that keeps a copy on your computer.
4. **Save as PDF** writes the message as a PDF with the sender, recipients, date, subject, the text and a list of attachments. Tick **Include every header** first to add a final page with every header line, which is the version to keep when where a message came from may be questioned.

**Open an attachment you do not trust**

1. Drop the file on the workbench and open the **Malware Scan** tab.
2. **Things in This File That Can Act** lists everything in it that runs, opens or fetches on its own, with a count of each. **Nothing Found** means there is none.
3. Choose **Save a Disarmed Copy**, or **Put the Copy on the Bench** to look at it on the other tabs first. The copy keeps the text, formatting, pictures and web links and loses everything in the list. A Word file with macros (`.docm`) comes back as a plain `.docx`.

Disarming works on PDF files, Word, Excel and PowerPoint documents, RTF documents and pictures. A password-protected file has to be unlocked first, and older Office files (`.doc`, `.xls`, `.ppt`) are not disarmed. The original is never changed, so it stays the evidence of what arrived.

**Get what you can out of a damaged file**

1. Drop the file on the workbench and open the **Repair** tab.
2. Choose **Diagnose the File**. It says what the file reads as, lists each problem it found, and gives a verdict: **Not Damaged**, **Repairable**, **Partly Repairable** or **Not Repairable**.
3. Choose **Repair a Copy** to rebuild the file, or **Carve Out What Can Be Read** to pull whole pictures and documents out of a file too damaged to rebuild.
4. A table lists every part that came back and every part that did not. Each copy can be saved or put on the bench to look at on the other tabs.

Repair works on Word, Excel and PowerPoint files (both the current and the older formats), zip archives and PDF files. Carving works on anything. Every copy is scanned for malware before it is offered, and the original is never changed.

**Get the text out of a scan**

1. Drop the scan or photograph on the workbench and open the **Text Recognition** tab.
2. Choose **Recognize the Text**. Each page is listed with what happened to it: **Already Had Text** for a page that had selectable text, **Recognized**, or **Low Confidence** for a page worth checking.
3. Click a page number to see its text beside the list, and compare it with the picture in the preview.
4. For a PDF, **Save Searchable PDF** keeps the same pages with the text laid invisibly behind them, so the file can be searched and copied from. **Save Text Only** saves the text as a plain text file, with each page headed.

**Sort and narrow the list**

The list is a table. Click a column heading to sort by it; click again to reverse. Right-click a heading and open **Columns** to add **Added** and **Safety**, which start hidden because the pane is narrow, or to hide any column you do not want; the same menu hides or pins the column you right-clicked. **Filter** is on that menu too, so you can show only the PDFs, or only files above a size.

**Get rid of a file**

Each row has a **⋮** menu with **Discard** in it, along with **Copy Name** and **Copy SHA-256**. Right-clicking the row opens the same menu. Everything goes when you close the page in any case.

## Things worth knowing

- **The fingerprints are calculated on your own computer.** They are the right figure for checking a file against one somebody sent you. A fingerprint that goes into a court record is calculated by Magna Carta's servers over the file they received, which is a different guarantee, and the tab says which one you are looking at.
- **Some files have no preview.** An archive, a program, and an encrypted document have nothing to show, and the workbench says so rather than holding an empty frame open. **Hide Preview** at the top right closes the picture on every tab and gives the readings the width; **Show Preview** brings it back, and the button beside it moves the file to the other side of the readings. Both choices are remembered.
- **Nothing is kept.** Files on the workbench stay in your own browser: they are not attached to a matter and not recorded as having been looked at. Closing the page clears them. **Convert**, **Repair**, **Text Recognition** and **Unlock** send the file to the firm's own engines when you press their button; the engine answers and keeps nothing.
- **The name is not the answer.** Everything here reads the file itself. Where the file and its name disagree, the workbench reports the file.
- **Recovering a lost password is not done here.** Unlocking a document you have the password for takes a moment. Searching for a password nobody has can run for days, so it does not run on a bench that clears itself; it goes to a screen of its own that can be left running.

## Related

- [File Hash & Integrity](file-hash-integrity.md) — verifying a file already stored in Magna Carta against the fingerprint recorded when it came in.
- [Metadata Inspector & Scrubber](metadata-inspector-scrubber.md) — what document metadata is and why it matters before a file leaves the firm.
- [File Unlock & Password Recovery](file-unlock-password-recovery.md) — the password-recovery side, which runs on its own.
- [A matter's documents](matter-documents.md) — where files that belong to a case live.
