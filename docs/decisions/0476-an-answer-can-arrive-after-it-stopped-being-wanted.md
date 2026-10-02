---
number: 476
slug: an-answer-can-arrive-after-it-stopped-being-wanted
status: Proposed
date: 2026-09-16
area: Web
summary: "The browser has the same race class as the write path and none of its machinery. A screen reads on a subject, the person picks another, and both reads resolve in whichever order the network chose — so the later-landing older answer writes the state and the screen shows the previous subject's data under the current subject's heading, looking exactly like a screen that loaded correctly. Five screens had each grown their own counter for this; `LatestOnly` is now the one shape, and `pnpm run lint:stale-response` fails a sixth, which is how the fifth was found (it named its field differently from the four that were known). Separately, `writeKey()` mints an idempotency key INSIDE each attempt, so a retry after an ambiguous failure is a different request and records the thing twice — the double-click it reads as protecting against is already handled by any in-flight flag set synchronously, because the event loop makes check-and-set atomic. `WriteIntent` holds one key across every attempt at one intent and rotates only after a success, so a retry replays through the idempotency machinery already there; the cost record window is the worked example and the misleading comment on `writeKey` is corrected in all four modules that carried it."
---

**An abort stops bytes arriving; it does not decide whether an answer that already arrived is still wanted. Those are different jobs and only one of them prevents the bug.**

**Context:** the concurrency work so far has been about the write path — the guard that refuses, the batch that rolls back, the object that serializes. The browser has the same class of race and none of that: a read is started on a subject, the person picks a different one before it answers, a second read starts, and both resolve. The order is the network's to choose and the slower one is frequently the first one, so whichever lands last wins the state.

What that produces is not an error. It is the previous matter's rows under the current matter's heading, indistinguishable from a screen that loaded correctly, and invisible in every test that resolves one read at a time — which is every test that existed.

Five screens had each solved it, separately, with a private counter. They agreed, which was luck rather than structure: a copy of this is written correctly and then edited incorrectly, and nothing goes red.

**Decision:** one `LatestOnly`, and a scan that fails the sixth copy.

**Aborting stays, and is not the mechanism.** An `AbortController` saves the bytes and is worth keeping. It cannot be the guard: an abort may arrive after the response already did, it does nothing for a read composed of several calls whose answers depend on each other, and it cannot stop an answer that had already resolved and was waiting its turn on the microtask queue. The guard decides whether an answer may be written; the abort is an optimization on top of it.

**The scan is what found the fifth.** Four were known by grepping a field name. The fifth called its counter something else, and turned up the moment the rule was expressed as the shape that matters — a private field both incremented and compared — rather than as a name.

**The write half is a different bug from the one the code thought it had.** `writeKey()` is documented as "a fresh idempotency key for one write attempt and its retries", and it is called inside the attempt, so each retry gets a different key. A double click is not the exposure: an in-flight flag set synchronously (`if (saving) return; saving = true`, no await between) is atomic, because the event loop is. The exposure is the **retry after an ambiguous failure** — a write the server committed before its response was lost, retried under a new key, recorded twice. `WriteIntent` keeps one key across every attempt at one intent and rotates only on success, so the retry replays through the idempotency machinery that already exists rather than racing a second mechanism against it.

**Rolled out deliberately, not by scan.** Whether a given write needs an intent depends on what a duplicate of it costs, and a scan cannot see that — many call sites pass the key into a helper whose guard lives in the caller. The cost record window is converted as the worked example, the misleading comment is corrected in all four modules that carried it, and the rest is a per-surface judgement rather than a sweep somebody would have to unpick.
