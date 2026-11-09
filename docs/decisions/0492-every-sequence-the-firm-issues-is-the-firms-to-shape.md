---
number: 492
slug: every-sequence-the-firm-issues-is-the-firms-to-shape
status: Accepted
date: 2026-09-19
area: Platform
summary: "The numbering register's `fixed` formulation is retired: invoice, time-entry and call-and-text numbers join the five already shaped by a scheme, so every sequence the platform draws is the firm's to formulate and a new one is a row rather than a renderer. Three things made that possible without changing a number any firm has issued. The segment model gains month, day and matter-number parts, so the day-scoped call number and the matter-prefixed entry number are expressible as templates rather than as special cases. The register gains `scopeSource`: a count is scoped by the scheme's own scoping parts (the general, collision-proof case) or by the DOMAIN, where the caller passes the key — a time entry counts within its matter's handle, an invoice within the letterhead chosen at finalize — and on such a run a scoping mark is refused because it would set a switch that does nothing. And `scopeDistinguishedBy` names the part a domain-scoped scheme must carry so two scopes' numbers stay apart, which is the time-entry matter number; the invoice run's is conditional and is enforced at finalize instead, where a bill drawn under a letterhead the scheme does not render is refused rather than silently issued a number the firm-wide run can issue too."
---

**Every number a firm issues is the firm's to formulate, and a new sequence is a row on the
register rather than a renderer of its own.**

**Context:** One register already held every sequence, but only five of the eight took a scheme.
Invoice, time-entry and call-and-text numbers were listed with a `fixedShape` sentence and a
reason, because each rendered something the segment model could not express: a call's number is the
day it happened plus a count within that day, an entry's is its matter's number plus a count within
that matter, and an invoice's is a count within the letterhead it was issued on. Each of those is a
SCOPE that no scoping part could derive, and two of them needed date pieces the model had no parts
for. Listing them as fixed was honest while that held; the owner's ruling of 2026-09-19 is that it
should stop holding — "invoices should also be customizable, same with time entry and call and
text numbers; make this modular or verify it is so, so that other numbers can be generated in
time."

**Decision:** Retire the `fixed` formulation. Three changes make the model reach the three runs.

1. **Three parts** — `month`, `day` and `matter_number`. The call number's built-in default becomes
   year, month, day and a counter with the three date parts scoping, which renders exactly the
   `2026-09-08-0042` it always rendered; the entry number's becomes the matter number, a dot and a
   counter. Nothing is special-cased in the renderer: a firm can now put a month in a matter number
   or a day in a custody number because the parts exist, not because three runs needed them.
2. **`scopeSource` on the register.** `segments` is the general case and the safe one: the scope key
   IS the joined rendered values of the scheme's scoping parts, so two records in different scopes
   differ in a part the number renders and the rendered number cannot collide — which is why a firm
   that drops the year from such a scheme gets one firm-wide run rather than a collision. `owner` is
   for a run the domain scopes, where the caller passes the key. A scoping mark on an owner-scoped
   scheme is refused at the save: the count restarts per matter or per letterhead whatever the
   template says, so the switch would do nothing.
3. **`scopeDistinguishedBy`.** An owner-scoped run gets no uniqueness from its template for free —
   two matters both count 0001 — so the part naming the scope is what keeps the numbers apart, and
   the scheme schema requires it. Time entries name `matter_number`. Invoices name nothing, because
   a firm has one letterhead scope until it deliberately opens a second; that refusal belongs at
   finalize, where a bill drawn under a letterhead the scheme does not render is refused by name
   rather than issued a number the firm-wide run can issue as well.

**Nothing a firm has issued changes, and only one firm can feel this at all.** Each default renders
byte-for-byte what its run rendered before. The one behaviour change is for a firm that has opened
a second invoice letterhead scope: its next scoped bill is refused until an administrator adds the
Office Code part to the invoice scheme, because the prefix that used to be bolted on by the
renderer is now a part like any other. That is a refusal on a bill somebody is trying to send,
which is disruptive — and the alternative is worse: silently rendering `00042` under two
letterheads, where the firm-wide run has already issued `00042`, is a duplicate invoice number in a
run an auditor reads end to end.

The same rule has a mirror, and it reaches further. Once the invoice scheme prints the office code,
a bill issued under no letterhead has no code to print, and every bill the web app sends today names
none — a letterhead is chosen only by a caller of the finalize route. So adding the part turns every
such bill into a named refusal (`invoice-numbering-needs-letterhead`), naming both ways out: issue
the bill under a letterhead, or take the part back out. Before that refusal existed the bill
reached the renderer and failed as a server error, which rendering the settings page and billing
against it found on 2026-09-24. The part stays on the invoice run's list because the firm that
opens a second letterhead needs it first — refusing it at the save would leave that firm no order in
which to do the two steps.

The call and text counter is re-keyed by migration, from `2026-09-08` to the `2026:09:08` the three
scoping parts derive. A counter the draw can no longer find restarts the day's count at one and
issues a reference number the firm has already said out loud, so the rows move with the model.

**Considered and rejected:** **Keeping the invoice prefix in the renderer** — a conditional segment
that renders the scope when there is one and nothing when there is not would be the one part in the
model whose emptiness is legal, and the model's refusal to render an empty part is what keeps every
number unambiguous. **Deriving the entry number's scope from the rendered matter number** — a matter
renumbered after the fact would restart its entries' count and issue a second 0001. **A date part
on the time entry run** — a capture batch takes several entries on one matter from one counter read
and renders them from one context, so a date part would stamp every entry in the batch with the day
the batch was taken rather than the day each was worked; the run's allowed parts exclude dates for
that reason. **Leaving the three as fixed and documenting why** — which is what the previous round
did, and what the owner has now ruled against.
