---
category: Changed
audience: public
---

**The File Workbench Metadata tab shows the values, not only the kinds.** `@magna-carta/metadata` now reports each field behind a finding (`FindingField`: a name, a value and, where the file says, a moment): the core, extended and custom document properties, the attached template and mail-merge source resolved to their paths, document variables, custom XML values, each comment's author, text and date, each tracked insertion, deletion, move and formatting change with its author and date, the hidden text itself and the part it sits in, and for pictures the EXIF camera, GPS location, altitude and timestamps, XMP, IPTC and PNG text and modification time. Values are cleaned of control and direction-override characters, capped at 400 characters, and listed up to 100 per finding with the rest counted. A moment with a zone is an instant shown in the reader's zone; one without (a camera clock) is shown as written and marked as having no time zone. The field is optional, so the scrub and every other caller are unchanged, and the api-worker metadata route publishes its documented counts-only shape through `withoutFieldValues`. The panel draws a table per kind (Author, Change, When for tracked changes; Property and Value for properties) with the existing per-table checkboxes, wraps long values, and stacks each row in a narrow pane so nothing scrolls sideways.

## Public

The Metadata tab on the File Workbench now shows what a file actually says: who wrote and last saved it, who changed or commented on what and when, the hidden text itself, and the camera, location and time a photo was taken.
