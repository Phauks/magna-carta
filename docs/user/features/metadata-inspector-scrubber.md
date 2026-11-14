# Metadata Inspector & Scrubber

Check what hidden information a file carries, then download a clean copy that is safe to share.

## What it does

Every document and photo carries metadata alongside its visible content. In a Word document that metadata includes the author's name, the firm name, tracked changes from every review round, comments from colleagues, hidden text, and edit history. In a photo it can include GPS coordinates that record exactly where the picture was taken, the capture device, and timestamps. When you send a file without checking, that metadata goes with it — to opposing counsel, to a client, or to the public — even though none of it appears on screen.

The Metadata Inspector shows you a clear list of what a file contains, grouped by risk. The Metadata Scrubber produces a cleaned copy with the metadata you choose removed. The original file is never changed.

Nothing is uploaded. The file is read in your own browser, and the clean copy is made there too. Closing the page clears both.

## When to use it

Use it before sending any file outside the firm — before attaching a document to an email, before producing files in discovery, before sharing a draft with a client, or before posting a photo anywhere. Catching an author name or a set of tracked changes before it reaches the recipient is far cheaper than dealing with the disclosure afterward.

## Supported file types

| Type              | Formats                  |
| ----------------- | ------------------------ |
| Word documents    | `.docx`                  |
| Photos and images | `.jpg` / `.jpeg`, `.png` |

Excel workbooks, PowerPoint presentations, PDF files and TIFF and HEIC photos are not read on this tab yet.

## Common tasks

**Inspect a file**

1. Open **File Workbench** in the sidebar, under **Firm**.
2. Drop in the file, or use **Add Files**.
3. Open the **Metadata** tab.
4. Each kind of hidden content it found has a table of its own: **Tracked Changes**, **Comments**, **Hidden Text**, **Document Properties** (the author and organization, dates, the editing history, a stored preview of the first page, and settings such as a mail-merge data source or template location), **Custom Data** (custom properties and data a document-management system attached), and **Picture Metadata** (camera details, location, editing software, and anything stored after the end of the picture). Each row says how many there are. The badges along the top name the kinds that matter most.

**Make a clean copy**

1. Inspect the file as above. Every table's box starts ticked.
2. Untick any table you want to keep. The line beside the buttons says how many kinds will be removed.
3. Choose **Save a Clean Copy** to save it to your computer, or **Put the Copy on the Bench** to add it to the workbench list so you can check it on the other tabs before sending it.

**Confirm the file is clean**

The copy is read again as soon as it is made. The tab says either that it carries none of what you ticked, or how many of the ticked kinds are still there. To see the full reading, put the copy on the bench and open its **Metadata** tab.

## Tips and edge cases

- **Accepting tracked changes is a content change, not just a metadata change.** When you choose to accept tracked changes, the document's visible text changes — inserted text is kept and deleted text is removed. Review the document before scrubbing if you are unsure which version of the content you want.
- **Comments contain the text of the comment and the author's name.** Deleting comments removes both.
- **A document can carry a picture of its own first page.** Word saves a small preview image inside the file. It is a picture, so it still shows tracked changes, comments, and hidden text exactly as they looked when it was saved — even after that markup has been cleaned out of the text. The Inspector reports it and the cleaned copy does not include it.
- **A photo can carry a whole other file after the end of the picture.** Motion photos from a phone keep a short video there, and files are sometimes combined this way deliberately. Nothing shows it on screen, and it travels with the photo when you send it. The Inspector reports it and the cleaned copy ends at the end of the picture.
- **The file size limit applies.** Very large files are refused with a clear message. If a file exceeds the limit, consider splitting it or, for documents, saving a PDF rendition first.
- **File types not listed above are not yet supported.** If you upload an unsupported type, the tool tells you clearly. For HEIC photos (common on iPhones), convert it to JPEG first on the **Convert** tab, then open the copy's **Metadata** tab.
- **The copy is named after the original with (clean) added**, such as `Engagement Letter (clean).docx`.

## Related features

- **Convert** on the File Workbench: turn a file type this tab does not read into one it does.
- **File Workbench** — inspecting and scrubbing is the **Metadata** tab there, alongside every other thing the firm can do to a file.
