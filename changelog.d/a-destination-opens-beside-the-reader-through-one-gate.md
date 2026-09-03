---
category: Changed
audience: internal
---

**Opening a new tab is one gated pattern.** Fifteen call sites opened beside the reader in three
spellings (`target="_blank"` anchors, `window.open`, `globalThis.open`) and no stated rule. They now
go through `apps/web/src/lib/navigation/open-beside.ts`, naming why the destination cannot open in
place from a closed set of reasons — `external`, `file`, `session`, `unsaved-work` — and a source
scan (`apps/web/test/open-beside.test.ts`) refuses any `_blank` that did not come through it. The
owner's ruling: a new tab is unusual here, and where it happens it follows one repeatable process
rather than a screen's own judgement.
