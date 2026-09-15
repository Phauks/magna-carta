---
category: Changed
audience: public
---

**An intake is numbered the moment the enquiry is written down.** The lifecycle ruling of 2026-09-06 said no number of any kind existed before a matter became active. The consultation sequence reversed half of that on 2026-08-31; the owner reversed the rest on 2026-09-14: "everything should have a number, intake would have a number as well."

An intake was already work — somebody took the call, a person is named responsible for it, a conflicts check may have run, procedure steps are being cleared against it — and the only name the platform had for it was its handle, which is what the platform joins on and what nobody can read back down a telephone.

**A third run, not a number moved earlier.** `matter.intake_number` is drawn at creation from a scheme whose `purpose` is `intake`, rendering `I2026-0001` until a firm configures its own. Drawing the consultation number at intake instead would have been cheaper and is the wrong shape: most enquiries are declined, so the consultation run would fill with numbers issued to nothing and stop being readable as a run of consultations — the same defect the consultation sequence was created to avoid on the matter run.

**Nothing is replaced.** Graduation adds the consultation number beside the intake number and opening adds the matter number beside both, so a file that came the whole way answers to three names and a note filed under any of them still resolves. Every surface that quotes a matter falls through to the newest number it has drawn; the matter list, the communications log and the intake desk search all of them.

The draw rides the existing `matter_number_counter` / `matter_number_allocation` mechanism under an `intake/` scope prefix rather than a third pair of tables. What each sequence IS — its prefix, its label, its retryable collision, whether a built-in default exists — moved out of the service's conditionals into `numbering/sequences.ts`: two sequences were two branches and read fine, three made the shape visible, and a fourth run is now one row rather than four edits. The migration backfills every row currently at status `intake` and seeds the counters to match.

## Public

**Every enquiry now has a number from the moment you write it down.** An intake gets its own number — `I2026-0001` unless your firm sets a different shape — so you can quote it to a caller, write it on a slip and find it again, without waiting for the file to become a consultation. When it does become one it gains a consultation number, and when it opens it gains a matter number; it keeps all of them, so an old note quoting any of those numbers still finds the file.
