---
category: Removed
audience: internal
---

**The `/tools` area is gone — the layout, the index, the catalogue projection and the `/tools/<id>`
addresses with it.** `toolRoute()` is `/<id>`, `ToolManifest.route` is deleted (nothing needs to
declare an exception to a prefix that no longer exists), and the five tool routes moved out of
`(app)/tools/` to the top level.

What replaced the index is what was already better at its job. Its two worthwhile parts were the
descriptors and the search, and neither belonged to it: the descriptors are the presentation layer's
and the search net is `toolSearchKeywords()`, both of which the command palette has rendered all
along — over every destination at once, from one keystroke, with no navigation first.

Three registries shrank with it. `tool-catalogue.ts` is deleted; `SUBJECT_GROUP_LABELS` moved to
`navigation/clusters.ts`, where a cluster's name sits beside its glyph and the group it folds inside;
and the eight catalog subject groups became four (`records`, `internet`, `mailing`, `files`) — eight
headings over nine tools is a heading per tool. `toolsByGroup()` sorts a cluster alphabetically by
name, because catalog order is a fact about this repository rather than about the firm.

The shared catalogue framework (`$lib/catalogue`) stays, with Reports as its one consumer. One screen
using a shared shape is not a reason to un-share it.
