---
number: 438
slug: a-matter-on-hold-keeps-its-number
status: Accepted
date: 2026-09-06
area: Matters
summary: "The matter lifecycle gains a hold rung beside open: an active matter the firm has stopped working without closing it, for a recorded reason such as a client who has stopped paying. A hold is reached only from open, keeps the matter number, draws and surrenders nothing, carries its reason and its instant on the row, and returns to open when released; a close from hold leaves them standing so a reopen returns the matter to its hold. The status window offers the pause beside the close and asks for the reason in place. One permission, matters:hold, in both directions."
---

**A matter on hold is an active matter the firm has paused, not a rung before numbering: it keeps
its number, carries its reason, and returns to active when released.**

**Context:** the owner, the morning after ruling the intake rung and the consultation's name, asked
for a hold status "for matters that are not closed, but there are various issues relating to why
they are no longer considered active, like clients not paying bills", with the condition that "no
matter number is assigned until it becomes an active matter", and that the status window must allow
the change. Two readings were possible. A hold could be a rung on the way in — a paused intake or
consultation — or a rung beside open, a pause of work already under way. The owner's words settle
it: "no longer considered active" presumes the matter was active, and the examples (unpaid bills, a
party gone quiet) are things that happen to an engagement, not to a walk-in.

**Decision:** `matter.status` is one of `intake`, `consultation`, `open`, `hold`, `closed`. A hold is
reached only from `open` and released only to `open`; `holdMatter` and `releaseMatter` are guarded in
the batch on the status they leave and confirm the committed status afterwards, the way the open
does, so a hold never overwrites a close that landed between the read and the commit. Nothing is
drawn and nothing is surrendered on either side: the matter number stands, and no number of any kind
exists before a matter is open, which is the owner's condition kept by construction rather than by
rule. The row carries `held_at` and `hold_reason`, paired by a CHECK, and the reason is required at
the contract and in the window: a pause nobody can explain or date is not one anybody can resume. A
close from hold leaves both standing, and `reopenMatter` reads `held_at` before `opened_at`, so a
matter closed while on hold returns to that hold. The docket keeps held matters under their own
status (they are numbered); the conflicts corpus treats them as live; auto-file rules fire on them,
because the firm paused its own work and not the correspondence; the active lists exclude them. The
status window offers Close Matter and Put On Hold on an active matter and Release Hold and Close
Matter on a held one — the steps a status allows, never a picker — and asks for the reason in place.
The audit events `matter.held` and `matter.released` are read by the matter timeline, the activity
section and the responsible member's notifications alongside the close and the reopen. One
permission, `matters:hold`, covers both directions and is seeded to Owner/Admin and Attorney, the
seats that may close a matter: whoever may pause the firm's work may resume it.

**Consequences:** a fifth stored status, so every enumeration of the vocabulary — filters, counts,
contract enums, status unions — carries `hold`, and the register prints it as On Hold in the
warning tone (something needs attention; nothing is wrong with the record). A matter cannot be
started on hold, and the New Matter window says so without a Soon mark. The migration is a second
reviewed rebuild of `matter`. A firm that wants a hold to block time or costs, or to age into a
close, has a seam and no rule: neither is built, and neither was asked for.
