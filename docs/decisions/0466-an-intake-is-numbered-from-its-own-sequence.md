---
number: 466
slug: an-intake-is-numbered-from-its-own-sequence
status: Accepted
date: 2026-09-14
area: Matters
summary: "An intake draws a number of its own the moment the enquiry is written down, from a third sequence beside the matter and consultation runs, rendering I2026-0001 by default. It is not an early draw on the consultation number, for the reason the consultation number is not an early draw on the matter number: most enquiries never become consultations, and a consultation run pitted with declined enquiries cannot be told apart from one with records missing. A file that comes the whole way therefore carries three numbers and keeps all three — graduation adds the consultation number beside the intake number and opening adds the matter number beside both — so a note filed under any of them still resolves, and every surface that quotes a matter falls through to the newest one it has drawn. The draw rides the same matter_number_counter / matter_number_allocation mechanism under an 'intake/' scope prefix, numbering_scheme.purpose gains a third value, and the per-purpose facts (prefix, label, retryable collision, whether a built-in default exists) move out of the service's conditionals into one table so a fourth run would be one row rather than four edits. This reverses the last of the 2026-09-06 lifecycle ruling that no number of any kind exists before a matter is active."
---

**A record the firm is already working on has to have a name, and "an intake" is not a name.**

**Context:** The lifecycle ruling of 2026-09-06 settled that no number of any kind existed before a
matter became active. The consultation sequence reversed half of that on 2026-08-31 — a consultation
is a real file with an intake sheet, a conflicts check and often a bill, and none of those can be
indexed by the word "consultation" — and left the intake rung where it was, unnumbered by design:
`createMatter`'s intake branch touched no counter, on the reasoning that an enquiry which goes
nowhere should consume nothing.

That reasoning was right about the RUNS and wrong about the record. An intake is already work.
Somebody took the call, a person is named responsible for it, a conflicts check may already have
run, and there are procedure steps being cleared against it — every one of which has to be referred
to, and the only name the platform had for it was its handle. A handle is what the platform joins
on; it is not something a receptionist can read back down a telephone or write on a slip. The owner,
2026-09-14: "everything should have a number, intake would have a number as well."

**Decision:** A third sequence. `matter.intake_number` is drawn at creation for an intake, from a
scheme whose `purpose` is `intake`, and frozen there. Graduation draws `consultation_number`
alongside it and opening draws `matter_number` alongside both; nothing is replaced.

Four things follow, and the first is the one the alternative got wrong:

1. **It is not an early draw on the consultation run.** The obvious cheaper repair — draw the
   tentative number at intake instead of at graduation, so a record carries two numbers rather than
   three — makes the consultation run a run of ENQUIRIES. Most enquiries are declined, so the run
   fills with numbers issued to nothing, and a firm reading it later cannot tell a declined caller
   from a consultation whose record went missing. That is the same defect the consultation sequence
   was created to avoid on the matter run, so it gets the same answer.
2. **A file that came the whole way answers to three names, and every one of them still finds it.**
   The matter list searches all three columns, the communications log searches all three, and the
   anchor resolvers fall through matter number, consultation number, intake number — the newest the
   record has drawn is the one a surface shows, because that is the one a person is being told now.
3. **The mechanism is the consultation sequence's, not a third copy of it.** Draws ride
   `matter_number_counter` and `matter_number_allocation` under an `intake/` scope prefix; `/` is
   outside the URL-safe set every rendered segment is folded into, so no matter scope key can
   collide with a prefixed one. A third pair of tables would duplicate the mechanism and the
   subtlety that makes it correct for no gain.
4. **The per-purpose facts move into a table.** Two sequences were two conditionals and read fine;
   three made the shape visible — the scope prefix, the sequence label, the retryable collision and
   whether a built-in default exists are four facts ABOUT A SEQUENCE, and spread across four
   branches they can disagree. `numbering/sequences.ts` holds them, and it is also the argument: a
   reader can see at a glance that every run but the matter run has a default, and why.

**Consequences:** The intake purpose falls back to a built-in default like the consultation purpose
does, and for the same reason — refusing to take an enquiry until somebody visits the settings screen
is the worse failure — so `usingDefault` on the numbering route stops being a `purpose ===
"consultation"` test and reads the table. The migration backfills every row currently at status
`intake` under the default scheme and seeds the counters to match, because those firms' enquiries
exist and the ruling is that they have numbers; matters that have already moved past intake are not
retro-numbered, since inventing a number for a rung whose record was never kept would be writing
history rather than recording it. The intake desk's Number column now shows a number for every row
it holds; its `UNNUMBERED_INTAKE` word survives for rows written before this sequence existed, and
the column keeps its `consultationNumber` id because that id is the key a reader's saved column
layout is stored under.
