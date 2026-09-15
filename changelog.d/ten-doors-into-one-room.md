---
category: Removed
audience: public
---

**The ten standalone file-utility rows leave the tool catalogue.** File Converter, Metadata Scrubber, File Hash & Integrity, File Decryption, File Type Verifier, AI-Text Detection, File Repair, OCR, Email Inspector and Malware Scan were each a File Workbench capability tab under another name, so the catalogue promised ten screens that do not exist and never would. The `files` subject group is now the workbench alone, and `test/catalog.test.ts` fails on a new row there.

Two things had to outlive the rows, neither enforced by a type. Their permissions: every capability module is gated on the key its sibling manifest declared, and `grantedPermissions()` built its set from `CATALOG`, so the deletion would have emptied the tab strip silently — `tool-permissions.ts` names all nine explicitly now, held to the capability registry by a test. And their search vocabulary, which moved onto the workbench's synonyms in `tool-presentation.ts`. The access-control registry entries and `role_permission` seeds are untouched and still used.

## Public

**Searching the file tools now takes you to the File Workbench itself, instead of to ten separate entries that all led to the same place.** Convert, hash, scrub metadata, unlock, verify a type, repair, read an email, recognize text and scan for malware are things you do to a file once you have brought it to the workbench, not nine different screens to choose between first.

Searching still works the way it did: "ocr", "scrub metadata", "malware", "checksum" and the rest all reach the workbench.
