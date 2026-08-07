---
category: Fixed
---

**Two full-suite test races quieted at their shared root: the live queue consumers the test pool
runs.** Under `@cloudflare/vitest-pool-workers` the queue consumers declared in `wrangler.jsonc` are
real — every message a test causes to be enqueued is delivered to the actual consumer about a second
later, concurrently with the rest of the test body. Two suites raced those deliveries and lost only
under full-suite CPU contention, when their own steps stretched past the broker's batch timer.
`search-reextraction-sweep` asserted `queued` and wrote simulated verdicts while the live
search-index consumer was recording its own honest verdict for the same in-flight message (`failed`,
"source bytes not found" — the fixtures store no bytes); it now asserts enqueued-ness rather than a
state a legitimate verdict may move, and waits each in-flight verdict out before overwriting it.
`document-assembly-protected-binding` submitted through the real route, which also starts the
coordinator's own queue message — a second, competing consume that (when the delivery won) decrypted
as the submitting owner and moved the decrypt-audit counts the suite exists to pin down; it now
seeds the assembly row directly, so exactly one consume — the one under test — runs. Both verdict
state machines were checked and left alone: the search-index coordinator's overwritable
`failed`/`deferred` is what lets a queue redelivery re-verdict honestly (`indexed` was already
absorbing), and the assembly consumer's done-row guard is the deliberate redelivery defence; neither
race exists in production, where nothing manufactures a second writer. Also repaired: three per-firm
drizzle snapshots (`0034`, `0040`, `0048`) carried a `prevId` naming a snapshot that no longer
exists — parallel-branch merge leftovers, now pointed at each snapshot's actual predecessor (lineage
metadata only; runtime reads the journal and SQL, and `drizzle-kit` diffs against the head snapshot
alone). `migration-integrity.test.ts` now walks the `prevId` chain across both lineages so the next
dangling ancestor fails in CI instead of sitting wrong indefinitely.
