# Metadata Inspector & Scrubber

Check what hidden information a file carries, then download a clean copy that is safe to share.

## What it does

Every document and photo carries metadata alongside its visible content. In a Word document that metadata includes the author's name, the firm name, tracked changes from every review round, comments from colleagues, hidden text, and edit history. In a photo it can include GPS coordinates that record exactly where the picture was taken, the capture device, and timestamps. When you send a file without checking, that metadata goes with it — to opposing counsel, to a client, or to the public — even though none of it appears on screen.

The Metadata Inspector shows you a clear list of what a file contains, grouped by risk. The Metadata Scrubber produces a cleaned copy with the metadata you choose removed. The original file is never changed.

Nothing you upload is stored. The tool works on the file, shows you the results, and discards it. No copy is retained in Magna Carta after you close or navigate away.

## When to use it

Use it before sending any file outside the firm — before attaching a document to an email, before producing files in discovery, before sharing a draft with a client, or before posting a photo anywhere. Catching an author name or a set of tracked changes before it reaches the recipient is far cheaper than dealing with the disclosure afterward.

## Supported file types

| Type                     | Formats                           |
| ------------------------ | --------------------------------- |
| Word documents           | `.docx`                           |
| Excel workbooks          | `.xlsx`                           |
| PowerPoint presentations | `.pptx`                           |
| Photos and images        | `.jpg` / `.jpeg`, `.png`, `.tiff` |

## Common tasks

**Inspect a file**

1. Open the Tools sidebar.
2. Select **Metadata Inspector & Scrubber** under **Documents**.
3. Upload the file by dragging it onto the upload area or selecting it with the file picker.
4. The Inspector shows the findings grouped by category — identifying metadata, tracked changes, comments, hidden content, custom properties, and (for images) camera data, GPS location, and edit history. Each finding shows a risk level and a count.

**Make a file safe to send — one click**

1. Inspect the file as above.
2. Select **Make safe to send**.
3. Download the cleaned file. The scrubbed copy has all tracked changes accepted, all comments deleted, all hidden text removed, all identifying document properties and custom properties cleared, and all image metadata stripped.

**Remove specific findings only**

1. Inspect the file.
2. In the findings list, toggle off any items you want to keep.
3. Select **Download clean copy**.
4. The scrubbed file reflects only the changes you chose.

**Confirm the file is clean**

After scrubbing, the tool re-inspects the output and shows you the result. A clean file shows no remaining findings for the categories you chose to remove.

## Tips and edge cases

- **Accepting tracked changes is a content change, not just a metadata change.** When you choose to accept tracked changes, the document's visible text changes — inserted text is kept and deleted text is removed. Review the document before scrubbing if you are unsure which version of the content you want.
- **Comments contain the text of the comment and the author's name.** Deleting comments removes both.
- **The file size limit applies.** Very large files are refused with a clear message. If a file exceeds the limit, consider splitting it or, for documents, saving a PDF rendition first.
- **File types not listed above are not yet supported.** If you upload an unsupported type, the tool tells you clearly. For HEIC photos (common on iPhones), convert to JPEG first using the File Converter tool, then run the scrubber.
- **The scrubbed copy downloads with the same file name.** Rename it before sending to avoid confusion with the original.

## Related features

- **File Converter** — convert an unsupported file type (for example, HEIC to JPEG) before scrubbing.
- **Tools** — Metadata Inspector & Scrubber is in the **Documents** group, accessible from the Tools sidebar.
