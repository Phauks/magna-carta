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
4. Each kind of hidden content it found has a table of its own, and each table lists what the file actually says:
   - **Tracked Changes**: who made each change, what they inserted, deleted or moved, and when.
   - **Comments**: who wrote each comment, what it says, and when.
   - **Hidden Text**: the hidden words themselves, and whether they sit in the body, a header, a footer or the notes.
   - **Document Properties**: the author, the person who last saved it, the title, the company, the template, the created and modified dates, the total editing time, and settings such as an attached template path or a mail-merge data source.
   - **Custom Data**: each custom property by name and value, and the values a document-management system stored in the file.
   - **Picture Metadata**: the camera make, model and serial number, the GPS location and altitude, when the picture was taken, the editing software, and the photographer and copyright.

   Something with no readable value, such as a stored preview of the first page or data after the end of a picture, is a row with how many there are. Long values wrap, and a table with a very long list shows the first hundred entries and says how many more there are. The badges along the top name the kinds that matter most.

   A date the file recorded with its time zone is shown in your own time zone. A date recorded without one, as most cameras do, is shown exactly as recorded and marked **No time zone recorded**.

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
