---
category: Fixed
audience: internal
---

**The gate of record has executed nothing since 2026-08-05, and the reason is not in this repository.
Ten days of pull requests merged against a status that looked like a failing build and was actually an
account that could not start a job.** The runner labels were never the cause; no workflow change lands
here, and the one action that clears it is now on the deploy queue.

The standing suspicion was that `ubuntu-slim` — introduced by the CI cost-reduction work — is not a
real runner label, and that fixing or reverting it would restore the gate. Checked against GitHub's
current runner reference, `ubuntu-slim` is generally available, needs no plan and no enablement: a
1-CPU / 5 GB container runner, exactly as `gate.yml`'s own `RUNNERS` header describes it. Three
independent observations then rule it out as the cause:

- Run 351 on `main` (2026-08-05, 04:04Z) failed with the identical fingerprint at a commit whose
  `gate.yml` carried **thirteen `ubuntu-latest` jobs and no `ubuntu-slim` at all**.
- `assemble-docs.yml`, which is entirely `ubuntu-latest` and contains no `ubuntu-slim`, has been
  failing the same way on every push to `main` throughout.
- Moving the `changes` job to `ubuntu-latest` on a live branch and pushing it reproduced the failure
  exactly — 2 seconds, `runner_id: 0`, no logs. The proposed fix was measured, and it does not work.

The outage began between 03:16Z and 03:46Z on 2026-08-05, three hours **before** `ubuntu-slim` first
entered the repository, which settles the ordering on its own. What actually happens is that GitHub
refuses to start any billable job for this private repository: the job is created, no runner is ever
attached, and it concludes `failure` in two or three seconds with a log endpoint that 404s. The Free
plan includes 2,000 Actions minutes a month for private repositories and GitHub blocks usage once the
quota is spent with no valid payment method — which is what the austerity note said on the day it was
written, before the diagnosis drifted into "no runner assigned" and then into a label theory.

**What lands:** the recognition rule in `operations.md` — `runner_id: 0` with an empty `runner_name`
is a job that never started, and it must be read as _unverified_, never as _broken_ — plus the owner's
billing step at the top of the deploy queue, a corrected date and cause in `ROADMAP.md` (it read
2026-08-07), and a revert checklist in `build-performance.md` that now keys off an observed non-zero
`runner_id` rather than a calendar month turning over. `gate.yml` itself is untouched, deliberately:
reverting the labels would spend three times the runner rate to fix nothing.
