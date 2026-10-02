---
number: 408
slug: derived-cloudflare-facts-are-read-live-never-committed
status: Proposed
date: 2026-08-30
area: Operations
summary: "Operational facts the Cloudflare account owns — which Workers are connected, each one's production branch, root directory, build command, Build Watch Paths and build-caching setting, which hostnames and routes each Worker answers on, when anything deployed and whether a build passed — are read live from the API at the moment of use and are never written down in the repository. The runbook and the deploy queue record the reasoning, the procedures, the failure modes and the invariants, and replace every derived value with the runnable command that returns it. The rationale is measured, not aesthetic: docs/conventions/operations.md wrote those values down and disagreed with the live configuration four separate times, each disagreement was corrected, and each correction decayed as soon as the dashboard moved again — a snapshot in a file reads exactly as confidently when stale as when fresh, and nothing in a merge can invalidate it. A drift-detecting fitness function was considered and rejected for the same reason: it needs a committed copy of the truth to compare against, which is the same snapshot with extra steps, and it cannot run in the gate of record because that gate has no Cloudflare credentials and must not require network."
---

**A value copied out of a system that changes without a commit is not documentation; it is a snapshot
with no expiry date printed on it. Delete it and keep the question.**

**Context:** `docs/conventions/operations.md` is the runbook of record for deploy-time platform
configuration. It carried the current values of the account's Workers Builds configuration, and it was
wrong four separate times:

- it claimed seven connected Workers when the account carried twelve, and claimed one of them was
  deployed by hand when it was not;
- it recorded `magna-carta-edit` at root directory `/`, with a `--filter` deploy command and a
  production branch of `slice-2-2-editing` — three claims that were all true when written and all false
  when next read;
- it recorded two Build Watch Paths that matched no file in the repository, which suppressed rebuilds
  silently rather than failing;
- and a reading of `apps/api-worker/wrangler.jsonc` produced the conclusion that no custom domain was
  attached to the app Worker, when the account holds an active zone whose apex hostname is bound to it
  as a custom domain. A custom domain attached in the dashboard appears nowhere in the repository and
  `wrangler deploy` does not remove it, so a Worker can carry `workers_dev: true` with no `routes`
  block and still answer a real hostname.

The common shape is that every one of those facts lives in a system a person can change by clicking,
leaving no commit behind. Each was corrected as it was found, and each correction was accurate for
exactly as long as nobody touched the dashboard. Correcting the file a fifth time restores accuracy on
the same terms and decays the same way.

**Decision:** Derived Cloudflare facts are **read live and never committed.**

`operations.md` and `docs/deploy-queue.md` record no current value of anything the Cloudflare account
owns. In place of each deleted value they carry the exact command that returns it, written to run as-is
against `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment. `operations.md` opens
with the rule and the four drifts as its evidence, so the next reader tempted to paste current values
back in reads the reason first.

What stays is everything the API cannot answer, because deleting that would lose knowledge held nowhere
else: the decisions and their reasoning, the operator procedures (email onboarding, zone setup, the
containment argument for the signing Worker), the failure modes that have each cost a deploy (the
bare-`wasm-pack` window, the recurring `ENOENT … <crate>_bg.wasm` class, the recovery Worker's
build-context trap, the `code: 10143` service-binding ordering rule, the atomic cron-schedule write),
and the invariants a reader must not violate.

**The alternative considered and rejected: a fitness function that diffs the runbook against the live
account.** It fails on its own premise. Such a check needs a machine-readable copy of the claims to
compare against, so the repository would hold committed data files asserting each Worker's branch, root
directory and watch paths — which is the same snapshot the four drifts came from, in a format that
diffs. It would relocate the staleness, not remove it. It also cannot run in the gate of record, which
has no Cloudflare credentials and must not require network, so it would run only when someone with a
token chose to run it — and a check nobody runs is not a gate. The honest version of that check is a
person typing one `curl`, which is what the runbook now gives them.

**Consequences.**

- Answering "what branch does this Worker build from?" costs an API call. That is the intended price:
  the call is correct, and the sentence it replaced was correct only by luck.
- A reader with no Cloudflare token cannot answer those questions from the repository at all. This is
  deliberate. Previously they got an answer that might be years stale and carried no signal that it
  was; now they get the command and the knowledge that they need credentials to run it.
- Dated `API-confirmed` markers surviving in `docs/deploy-queue.md` are explicitly relabelled as
  history — why an item was closed on the day it was closed — never as a claim about the account now.
- Comments in `wrangler.jsonc` are subject to the same failure and are not covered by this decision.
  `apps/web-worker/wrangler.jsonc` still asserts that the account has no zone hostname for the app,
  which the account contradicts. Correcting it is an application-configuration change for the owner.
