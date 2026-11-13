# PDF Editor

Use the PDF Editor to change a PDF that is on a matter. Nothing you rely on is overwritten:
redacting, numbering, watermarking, protecting, extracting, splitting and signing save new files beside the original, and arranging the pages
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

## Forms

The Forms tab fills in a PDF form, such as a court or tax form, without leaving Magna Carta.

1. Each field the form holds is listed on the right, in page order, with its page number. Choosing
   a field rings it on the page preview, so you can see where it sits.
2. Type an answer, tick a box, or pick from a list. A field the form marks as required shows a
   **Required** badge until it has an answer.
3. To make the answers part of the page, so nobody can change them later, tick **Flatten**. A
   flattened form can no longer be filled in.
4. Choose **Save as New Version**. The button counts the answers you changed.

Only the answers you changed are written, so a field you did not touch keeps what it held. Fields
the form marks as read-only, buttons and signature fields are shown but cannot be answered here.
The answers are saved as a new version of the same file, and earlier versions are kept.

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

## Secure

Protect a copy with a password before it goes out, and choose what the people who receive it can do.

**What This File Carries** counts what is in the file besides its pages: text hidden under
something, comments, metadata, hidden layers and filled-in form fields. It shows how many, never
what they say. If it finds hidden text, redact it first: a password does not remove anything.

1. Set a **Password to Open** if the copy should ask for one. Leave it empty for a copy that opens
   freely but still keeps its permissions.
2. Set a **Password to Change Permissions**, or leave it empty and one is made for you. A made
   password is shown once when the copy is saved; keep it somewhere safe, because Magna Carta does
   not keep any of these passwords.
3. Under **Recipients May**, tick what they can do: print, copy text, edit or fill forms, comment.
4. Choose **AES-256**, or **AES-128** only if the recipient has an old PDF reader.
5. Leave **Remove metadata, attachments, form values, bookmarks and layers first** ticked unless
   the recipient needs those.
6. Choose **Save Protected Copy**.

The protected copy is saved beside the original, named with **(Protected)** at the end. The
original is not protected.

## Signature

Send a document to be signed, and follow it until everyone has signed.

**Signature Fields.** Add the people who sign. Type a name and email for someone outside the firm,
or pick a colleague under **Firm Member**. Each signer gets a colour.

1. Choose a signer in the list to place fields for them.
2. Pick a field above the page: **Signature**, **Initials**, **Date Signed**, **Full Name**,
   **Text** or **Checkbox**.
3. Click the page where it goes, or drag to draw it at the size you want. Click a field to change
   its kind, give it to another signer, make it optional, or remove it.

For each outside signer, choose how they prove who they are: **Emailed Link** (anyone who opens the
email can sign) or **Link and Email Code** (they also enter a one-time code sent by email).
Colleagues sign while signed in to Magna Carta.

**Review and Send.** Choose whether people sign **In Order** or **All at Once**, write the email's
subject and message, choose the last day it can be signed and how often reminders go out, then
choose **Send for Signature**. If something is missing, such as a signer with no signature field,
the request is not sent and you are told what to fix. **Save Draft** keeps the request to finish
later.

The document sent is the file's current version. Its fingerprint is recorded when it is sent.

**Following a request.** After sending, the tab shows who has signed, who is next, and everything
that has happened and when. **Send Reminder** emails whoever is waiting now. **Cancel Request**
stops the links working; signatures already given stay on the record. Saving the signed copy and
its Certificate of Completion beside the original when everyone has signed is coming next.

**What an outside signer sees.** Each outside signer is emailed a link when it is their turn. The
link opens a page with your firm's name, the document's title and your message. If you chose
**Link and Email Code**, they first ask for a code by email and enter it. They then read and agree
to sign electronically, and the document opens with their own fields marked on it. **Next Field**
takes them to the next thing to fill in. On the first signature or initials field they adopt their
signature by typing their name, drawing it, or uploading a picture of it, and tick that it is as
binding as signing by hand. **Finish** records their signature and sends the link to whoever signs
next. **Decline to Sign** ends the request for everyone and tells you why, if they say.

A reminder sends the same link again, so an earlier email still works. A link stops working when the
request is cancelled, declined or past its last day, and the page says which.

Colleagues you add as signers cannot sign inside Magna Carta yet, so a request with a colleague as
a signer waits at their turn until that arrives.
