---
category: Added
audience: public
---

**A firm can read the checks it has run.** `GET /api/v1/conflicts/checks` pages them newest first
over the uniform `{ data, nextCursor }` envelope, optionally narrowed to one matter. Each line names
what set the run going, who asked where anybody did, the strictness and depth it ran at, whether the
firm's floor raised the scope above what was requested, and how many candidates surfaced — never a
conclusion about them, which is a reviewer's act recorded as a disposition.

**The load-profile plan probe was right, and it was right in advance.** The design said the
unfiltered listing would plan a full table scan because `conflicts_check`'s only index leads with
`subject_matter_id` — which serves one matter's own history and cannot serve a listing across every
matter. The probe measured exactly that on the first run. `conflicts_check_created_id_index` on
`(created_at, id)` landed in the same change rather than as a note to revisit, and both shapes of the
read are now probed separately because they plan differently.

That index is not a micro-optimization. The conflicts log is append-only by design, with
`RAISE(ABORT)` triggers refusing UPDATE and DELETE, so a scan there is not a fixed cost — it rises
every week a firm operates.

The row is deliberately narrow: the whole check, its recorded scope, its statement and its hits are
one identifier away, and a listing carrying all of it would read every check's `inputs_json` for a
surface that shows none of it. The hit count comes from a correlated subquery served by the
`(check_id)` index rather than a `GROUP BY` join, which would have to de-duplicate the check row per
hit before the limit could apply.

## Public

**The conflicts screen now lists the checks your firm has run.**

It used to say the platform knew the question and could not answer it. Each line shows when the check
ran, what started it, who asked for it where a person did, and how many candidates it surfaced —
and opens the check itself.

A check that ran automatically says so rather than showing a blank where a name would be: nobody
asked for it, and that is a different fact from the record not saying who did.

Where a check searched more widely than it was asked to — because the firm's own floor raised it —
the line says so, which is what explains a result set larger than the person who ran it expected.
