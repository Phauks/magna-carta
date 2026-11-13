# PDF Editor

Use the PDF Editor to change a PDF that is on a matter. Nothing you rely on is overwritten:
redacting, numbering, watermarking, extracting and splitting save new files beside the original, and arranging the pages
saves a new version, with the version before it kept in the file's history.

To open it, open a PDF from the matter's documents and choose **Edit PDF**. Choose **Read** to go
back to reading it.

## Pages

Put the pages in a new order, turn them, or take some out.

1. Choose a page to select it. Choose it again to clear it. Hold **Shift** to select every page
   between the last one you chose and this one.
2. With pages selected, you can:
   - **Rotate Left** or **Rotate Right** to turn them a quarter turn.
   - Drag them to a new place, or choose **Move Earlier** or **Move Later** to move them one place
     at a time.
   - **Delete** them.
3. Choose **Save as New Version**. Until then nothing is changed, and **Reset** puts every page
   back as it was.

Each page shows its new number, and **was** with its old number if you moved it.

Two more tools make new files and leave this one as it is:

- **Extract to New File** saves the selected pages as a new file, named with the page numbers,
  for example **Exhibits (Pages 3-5).pdf**.
- **Split Into Files** starts a new file at each selected page. Select page 4 and page 9 of a
  12-page document to get three files: pages 1 to 3, 4 to 8, and 9 to 12. Each is named with its
  part, for example **Exhibits (Part 2 of 3).pdf**.

A PDF locked with a password must be unlocked in the [File Workbench](file-workbench.md) first.

## Redact

Redacting removes text and images from the pages, so they cannot be read, copied or searched in the
copy you send out.

1. Drag a box over each passage to withhold. To withhold a whole page, choose **Redact Whole Page**.
2. Each box is numbered and listed on the right. Choose a **Reason** for each one, such as Phone
   Number or Privileged. The reason you chose last is used for the next box.
3. To remove a box, choose the bin beside it. To find a box, choose its page number.
4. Choose **Apply Redactions**.

Magna Carta then removes what is under each box and checks the result before saving it. Where it
cannot be sure the text under a box is gone, it turns that page into a picture, so nothing under
the box survives. The copy is saved in the same folder as the original, named with **(Redacted)**
at the end.

Two options sit under the list:

- **Also remove hidden data** removes the document's metadata, attachments, form values, bookmarks
  and layers, which can hold the same information you redacted. It is on unless you turn it off.
- **Save a redaction log** saves a spreadsheet beside the copy listing each redaction's page and
  reason. It never records what was redacted.

A PDF locked with a password cannot be redacted until it is unlocked. Unlock it in the
[File Workbench](file-workbench.md) first.

## Bates

Bates numbering prints a running number on every page, such as **SMITH-000041**, so each page of
a production can be cited.

1. Enter a **Prefix** and, if you use one, a **Suffix**.
2. Set the **First Number**. For a second production, start where the last one stopped.
3. Set the **Digits**. Numbers shorter than this are padded with zeros, so 6 digits writes 41 as 000041.
4. Choose the **Position**, **Typeface** and **Size**. The first and last pages show where the
   number will go.
5. Choose **Number the Pages**.

The numbered copy is saved beside the original, named with its first and last numbers, for example
**Production (SMITH-000001 to SMITH-000016).pdf**. The message afterwards tells you the number the
next production should start at.

Numbering adds text to each page and removes nothing. To withhold something, redact it first, then
number the redacted copy.

## Watermark

A watermark prints a word such as **CONFIDENTIAL**, or an image such as the firm's logo, faintly
across the pages.

1. Under **Mark**, choose **Words** or **Image**.
2. For words, pick one of the usual ones or choose **Other** and write your own. Set the
   **Typeface**, **Size** and **Colour**. For an image, choose a PNG or JPEG and set its width.
3. Set the **Strength**, the **Angle**, and whether the mark appears once in the middle or
   **Repeated** across the page.
4. To mark only some pages, write them under **Pages**, such as **1-3, 7**. Leave it empty to mark
   every page.
5. Choose **Mark Pages**; the button says how many. The page shown is the first one that will be marked.

The marked copy is saved beside the original, named with the words, for example
**Brief (Confidential).pdf**. A watermark is printed on top of the page and removes nothing.
