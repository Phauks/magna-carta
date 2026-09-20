---
category: Changed
audience: public
---

**The file icon resolves from the name first; the type-mismatch finding grades in the icon's own
vocabulary.** `resolveFileCategory` in the design system's file-icon module reads the extension
before the sniffed content type, and an unrecognized extension resolves to `unknown` rather than
falling through to the bytes. A bytes-first sibling, `resolveFileContentCategory`, serves handling
decisions (`editable-documents.ts` keeps opening a Word document renamed `.txt` in the Word editor).
`file-analysis.ts` drops its ten-entry extension-to-MIME list and compares `claimedFileCategory`
against `sniffedFileCategory` at the level of kind: an unrecognized extension over a read sniff is a
mismatch, no extension is no claim, a sniff with no known kind is no reading. Rulings round R25.

## Public

**The icon beside a document now shows what its name says it is, and File Analysis says whether
that is true.** Before, a Word document renamed to end in `.do` kept its Word icon and DOCX label
while the File Type column read `do`, and no check said anything. Now the icon, the File Type column
and the type in words all read the name, an ending nothing recognizes draws a blank sheet with no
label, and a name that disagrees with the document's contents is reported as a Type Mismatch, over
every ending the icon knows. Opening a document is unchanged and still goes by its contents.
