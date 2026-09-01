---
category: Added
audience: public
---

The download register: a per-member shelf at `/downloads` of what the platform produced for that
member, held for seven days and downloadable again until it expires. It exists because the platform
had no durable record of a generated file at all — a bulk bundle is addressed by the content hash of
its selection and a conversion by its job id, both held only in a Durable Object and an R2 object, so
a member who closed the tab lost the artifact while its bytes sat in the bucket until the lifecycle
rule reaped them.

Routing completions through the notification feed was considered and **rejected on the owner's
ruling: notifications carry matter work, and a generated file is platform mechanics.** The two
surfaces stay separate in both directions — no producer raises a notification to say an artifact is
ready.

Two row kinds share one table because the member asks one question. A kept **artifact** points at
bytes that cannot be re-derived and re-downloads as a freshly minted presigned GET, so the browser's
own download manager keeps pause and resume; the register never proxies bytes. A kept **snapshot** is
an export, and stores the tabular DOCUMENT rather than a rendered file — one row serves every format,
and cells keep their number face so a re-rendered workbook still sums. New: `download_item` (per-firm,
member-scoped, journaled with its `downloads:shelf` seed to every default role), four routes under
`/api/v1/downloads`, and a retention sweep on the daily per-firm cron that takes the stored document
before the row. The export menu keeps every download it takes, in all six formats, including the three
the browser renders and the printer never sees.

## Public

**Your downloads now have a home.** Anything the platform makes for you — a report you exported, a
bundle of files — gathers under **Downloads** in the sidebar for a week, so you can take it again
without running it a second time. Each row shows what it is, when you made it, which formats you have
already taken, and when it stops being available. An exported report can be taken again in any
format, not only the one you chose first, and it holds the figures exactly as they were when you ran
it. Clear anything off the list whenever you like.
