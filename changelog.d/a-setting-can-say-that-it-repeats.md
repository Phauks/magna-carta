---
category: Added
audience: public
---

**A calendar setting can carry a repeat rule.** A new `recurrence_rule` column on `matter_event` and `firm_event` (migration `20260916T000000_event-recurrence`), threaded through both statement modules, both services, the shared `event-shape` asserts, and the create/update/detail contracts on both scopes. The record forms and the entry window edit it through one `recurrence-field.svelte`, over the rule the draft holds.

**One row carries the series; nothing writes an occurrence.** A weekly status conference is one record with a rule on it, not fifty-two records. A row per date would multiply a firm's calendar by the length of its longest series before anybody looked at it, make "move the series" fifty-two writes, and make a correction a reconciliation. The dates are read back from the rule, inside the window somebody asked for — a year at most, which is the platform's own cap — so the work is bounded by what is on screen rather than by how far the rule runs.

**The grammar lives in `@magna-carta/civil-time/recurrence`, which both sides depend on.** The form writes a rule and the calendar service has to refuse one it could not itself have written; the web app does not depend on `@magna-carta/calendar` (a backend package carrying SQL), so a grammar held in either would have been copied into the other, and two readings of "what is a valid rule" disagree the first time one of them is corrected. A rule this platform cannot read back is a series nobody could edit again, so it is refused at the write (`calendar-invalid-recurrence`) rather than stored.

**RFC 5545 is the storage, and it is deliberately read narrowly.** `FREQ`, `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`, and `BYSETPOS` only in the one spelling this product writes. `parseRecurrence` answers null for anything else — a real answer the surfaces treat as one: the event still reads and still paints, and the form states that the rule was recorded elsewhere rather than half-showing a simplified version that saving would make true. The standard is stored rather than a private shape because a firm exporting its calendar should not find this product's dialect in it.

**Expansion walks civil days, never instants.** A weekly nine o'clock setting is nine o'clock on both sides of a daylight-saving change, which is true only because the walk counts days and the wall clock rides along untouched. A month with no such date — the 31st in February — is skipped rather than pulled back to the 28th: a firm that said the 31st did not mean the end of the month, and inventing a date it did not choose is worse than a month with no occurrence in it. A `COUNT` is counted from the series' own beginning, so occurrences before the window still count against it.

**A continuance does not inherit the series.** Continuing a hearing moves one setting to a new date; carrying the rule across would make the replacement repeat, which nobody asked for.

Nothing here generates deadlines. A recurring event is not a docketing rule, and the no-arithmetic position on deadlines is untouched. The occurrences are not painted on the grid yet — that is the next slice, along with the this-occurrence-or-series question an edit has to ask.

## Public

**A setting on the calendar can repeat.** Recording a hearing or a firm meeting now asks whether it happens more than once. Choose how often — every day, week, month or year — and how many to skip between, so "every second Tuesday" and "every third month" are both one answer. A weekly rule falls on the day the setting starts unless you pick the days yourself, and can fall on several. A monthly rule asks which day it means: the same date every month, or the same weekday in the same position — the 15th, or the third Tuesday. Then say where it stops: never, after a number of occurrences, or on a date.

**The form reads the rule back to you in words before you save it** — "Repeats every second Tuesday, 12 times" — and the record and the printed sheet show the same sentence. A repeat is the one answer on that form whose mistake is invisible until somebody misses a setting, so it is stated rather than left to be inferred from four controls.

**It is one record, not one per date.** Correcting a weekly status conference is one correction, not fifty-two. A month that has no such date — the 31st in February — is skipped rather than moved to the 28th, because a firm that said the 31st did not mean the end of the month. And a weekly nine o'clock setting stays at nine o'clock when the clocks change.

**A repeat rule brought in from another calendar is shown as exactly that.** Where it is more elaborate than this form offers, the form says the rule was recorded elsewhere instead of showing you a simplified version that saving would make true. Turning Repeats on replaces it with yours.
