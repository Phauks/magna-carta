---
number: 357
slug: a-job-that-never-started-is-unverified-not-failed
status: Proposed
date: 2026-08-15
area: Dev tooling
summary: "The gate's two-tier runner choice stands — `ubuntu-slim` for the short, single-threaded jobs and `ubuntu-latest` for everything that needs cores, memory, privilege or more than fifteen minutes — because `ubuntu-slim` is a generally available GitHub-hosted label requiring no plan and no enablement, and because it is provably not the cause of the outage that has kept the gate from executing since 2026-08-05. The outage is an account-side billing block that refuses to start any billable job at any label, established by three independent observations: a run on `main` that failed identically when `gate.yml` had thirteen `ubuntu-latest` jobs and no `ubuntu-slim`, a second workflow with no `ubuntu-slim` failing the same way throughout, and a live experiment that moved the root job to `ubuntu-latest` and reproduced the failure exactly. Reverting the labels would therefore triple the runner rate and fix nothing. The decision this records for the future is a classification rule, because the failure is invisible at the altitude anyone reads it: a job reporting `runner_id: 0` with an empty `runner_name`, concluding in seconds with a log endpoint that 404s, never started, and a change under it is UNVERIFIED rather than broken — a distinct state from a red build, carrying a different response (check the account, not the diff). The guard is deliberately a recognition rule in the runbook rather than a workflow job, because any in-workflow canary would be killed by the very condition it exists to detect."
---

**A gate that cannot start a job reports the same red as a gate that ran and found a bug, and for ten
days nobody could tell the two apart. The fix is not a workflow change; it is a name for the third
state.**

**Context.** Between 2026-08-05 03:16Z and 03:46Z the gate of record stopped executing. Every run
since — more than two hundred of them — concluded `failure` in under fifteen seconds without running a
step. It looked exactly like a normal failing build: the run appears in the Actions tab, checks go red
on the pull request, branch protection blocks the merge. The difference is only visible one level
down, in a field the run's own web page does not display.

Two wrong explanations grew in that gap, and each cost time. The first, "GitHub assigns no runner,"
was a correct symptom promoted to a cause, and being unfixable-by-anyone it stopped inquiry. The
second, that `ubuntu-slim` is not a real label and arrived with the cost-reduction work, was
plausible, well-motivated by timing, and wrong: the label is generally available per GitHub's current
runner reference, and the outage began three hours before it entered the repository. Acting on the
second explanation would have reverted a measured optimization, tripled the rate on seven jobs, and
left the gate exactly as dead — while appearing to be a fix, which is the expensive part.

What makes this failure durable is that the evidence disconfirming both explanations is cheap and
nobody was looking for it: `assemble-docs.yml` has no `ubuntu-slim` in it and was failing identically
the whole time, one API call away.

**Decision.** Three parts, only one of which is a change to anything.

1. **The runner tiering stands as written.** `ubuntu-slim` for jobs that are short and not meaningfully
   parallel, `ubuntu-latest` for the WASM build, the container gate, the type-aware lint, the
   type-check, the Miniflare shards, the story suite and the Rust gate. The constraints that decide
   the split — a 15-minute platform cap, 5 GB of memory, an unprivileged container with no Docker
   daemon — are recorded in the workflow's own header beside each job's measurement, and each job's
   choice is re-measured when its honest time grows, not revisited on suspicion.
2. **`runner_id` is the discriminator, and "unverified" is a first-class verdict.** A job with
   `runner_id: 0` and an empty `runner_name` did not run. The change under it is unverified — not
   broken, not passing — and the correct response is to check the account, never to debug the diff. A
   pull request in that state says so plainly rather than implying a gate that did not happen.
3. **The guard is a recognition rule in the runbook, not a job in the workflow.** This was the
   tempting alternative and it cannot work: a canary job that fails loudly when no runner attaches
   would itself need a runner, so the condition it detects is the condition that silences it. Nothing
   inside GitHub Actions can observe Actions being unable to run. The only workable automated guard
   lives outside — whatever polls the repository already — and the cheap durable version of it is the
   documented `runner_id` check, which is one API call and needs no infrastructure.

**Alternatives considered.** Breaking the `changes` fan-out, so one dead root job does not skip the
whole battery, was proposed as the structural fix. It is rejected: the fan-out is what makes a
docs-only push cost two minutes, and it did not cause this — `assemble-docs.yml` has no `changes` job
and died anyway. The fan-out only decides which job's name appears on the tombstone. Removing
`ubuntu-slim` "to be safe" is rejected as measured-false above.

**Consequences.** No workflow change ships, which is the point: the repository was never broken. The
owner gains one billing step at the top of the deploy queue, and it gates every merge rather than
every deploy, so it outranks the entries below it. The austerity posture's revert trigger changes
meaning — it now keys off an observed non-zero `runner_id` rather than a calendar month turning over,
because the two came apart and the calendar was the one being watched. And the austerity's premise
deserves re-examination when the block clears: the tiers were suspended to conserve an allotment that
turned out to be exhausted for the entire period, so the saving they bought was never realised.
