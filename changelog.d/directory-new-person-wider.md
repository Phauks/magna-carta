---
category: Changed
audience: public
---

**New Person's form is wider beside the duplicate check.** A primary pane that carries a section rail now stops at the new `size.record-form` token (832px: the record's 640px measure plus the rail) instead of `size.record-pane`, through `.mc-modal-frame-pane:has([data-record-rail])` in `modal-frame.css`. `record-sections.svelte` marks its rail. A three-field name row and the email row's kind, address and use now fit on one line.

## Public

**The New Person form has more room.** The name, contact and address fields are wider, so a row such as an email address with its use fits on one line. The "May already be in the directory" list beside it is a little narrower.
