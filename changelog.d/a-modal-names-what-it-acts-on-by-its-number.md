---
category: Changed
audience: public
---

**A panel's second line is the record it is acting on, by the number somebody quotes.** The subtitle slot on `ActionDialog` and `RecordWindow` was contracted to name what is being acted on and to carry the record's own reference, and the owner ruled on 2026-09-08 that it is not the place for a paragraph about what a subsystem is for. Nothing enforced either, and the slot was typed `string`.

**A slot typed `string` accepts a paragraph.** Across 82 panel openings, 18 of 54 subtitles were prose about the subsystem, four billing panels put a number and a sentence in one interpolated string behind a middle dot in three places and an em dash in a fourth, `tabular-nums` was hand written 138 times, and the preview-before-save the owner asked for had reached exactly one file.

**So the slot takes a `RecordSubject` and the design system renders it.** An optional `RecordReference` — `kind`, `number`, and a `standing` of `drawn`, `tentative` or `preview` — plus short facts about that subject. The three standings are the domain's own: a matter number is drawn, a consultation number is tentative and outlives the matter opening, and a preview is what the next record would take. `RecordSubjectLine` states the preview's own wording in one place instead of one file, renders "A number is drawn when this is saved." rather than silence where no number exists yet, and owns the separator so no call site chooses one. The bare `string` arm is gone, which is the mechanism rather than a side effect: a sentence about the act has nowhere left to go, because the heading names the act.

Every panel that carried prose lost it — deleted where it restated the heading, moved beside the field it explains where it was load-bearing. Panels that held a record's number and showed something else now show the number: the two queue acts on a call or text state that message's own reference, the three custodian panels state the packet's custody number, and bill review states the invoice number.

## Public

**Every panel now tells you which record it is about.** The line under a panel's title is the record's own number — the matter, the bill, the message, the packet — instead of a paragraph explaining the feature. Where a record is numbered only when it is saved, the panel shows the number it is about to take and says so, so you can write it down while you are still on the telephone.
