---
category: Changed
audience: public
---

**A form that refuses now points at the field.** The commit's refusal has always been one sentence at the weak end of the bar — "A date is needed." — which says what is wrong and leaves the reader to find what it is about. On a short form that is a glance; on the record form, which asks about a matter, a title, a type, two dates, two times, a zone, a repeat, a location, a court reference, a link, a description and a list of people, it is a hunt (owner, 2026-09-16: "We need better visual language to showcase what is still required when the item cannot be saved").

Every calendar draft's shortfalls are now `Shortfall[]` — a field and a sentence — rather than bare strings (`apps/web/src/lib/calendar/shortfall.ts`). The bar shows the first sentence, unchanged, and the field it names carries the SAME sentence beneath it with `aria-invalid` on the control. One wording, written in the draft and rendered twice, so the bar and the field cannot drift. `shortfallSentences` is what a caller that only wants the bar reads, which is how the existing assertions stayed meaningful rather than being loosened.

**Nothing is marked before a save was asked for.** A form that opens with every unanswered field already marked has told the reader they are wrong for not having typed yet, so the marks appear together the moment a commit is pressed and refused, and clear on a save that lands. `field-refusal.svelte` renders in the design system's own `mc-form-errors`, so a refused field here and a refused field on a superforms-validated form read the same — there is one answer to "what does a refused field look like", not a second invented on the calendar.

The pattern is deliberately not lifted into the design system yet. It is a type, two helpers and three lines of markup over a recipe that already exists; a component would be a second name for it. The second surface that wants it is the moment to move it, and the module says so.

**And the rail answers whose calendar, so the toolbar now answers what kind.** `schedule-narrowing.ts` narrows the window to case settings, deadlines, firm events or dates. It filters what was already read and makes no request, so it reaches exactly as far as the window on screen — which is why it sits beside the window's own navigation rather than beside a search that would imply the whole record. A narrowing is never a read: turning a calendar off in the rail stops a request, turning a kind off does not, and keeping the two apart is what stops a reader thinking they have made the screen cheaper when they have only made it shorter.

An untouched control means EVERY kind, so the first press removes one rather than isolating one — pressing Deadlines means "not deadlines". Turning every kind off shows the whole window rather than an empty grid, because an empty answer to "show me nothing" is technically right and useless, and the one thing a calendar must not do is look empty when it is not.

## Public

**When a record will not save, the fields that need answering now say so.** The reason still appears next to the button, as it always has — but the field it is about is marked too, with the same sentence underneath it, so you are told where to go rather than only what is wrong.

Nothing is marked while you are still filling the form in. The marks appear the moment you try to save and cannot, and they clear when the record goes in. A field with two things wrong with it shows the first, because fixing that one usually settles the other.

**And the calendar can be narrowed to the kinds that matter.** The list on the left says whose calendars you are looking at; the new **Kinds** control at the top says what sort of thing — case settings, deadlines, firm events, or dates from the register. Not every week needs all four at once.

Every kind is shown until you say otherwise, so the first press takes one away rather than leaving you with one. **Show Everything** puts them back, and appears only when something is being held back. Turning all four off shows you everything rather than an empty calendar.
