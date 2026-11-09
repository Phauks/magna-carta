# Fable whole-program review — 2026-07-01 (snapshot)

A point-in-time correctness audit of the whole backend, run as three waves of paired agents on
2026-07-01/02: one reviewer per area across 25 areas, every finding then adversarially
re-verified refute-by-default by a second, independent agent. It logged work items and changed
no product code. **173 findings survived verification** — 1 critical, 29 high, 71 medium,
72 low.

**This file is a snapshot. Do not edit the findings.** It records what the review said on
2026-07-01, and its value is that it stays fixed — the working state of each finding lives in
the companion ledger:

- **Verification ledger — [`2026-07-01-fable-whole-program-review-verification.md`](2026-07-01-fable-whole-program-review-verification.md)**: every finding by id, with its current status and the evidence behind it. Start there; point a verifying worker at it, not at this file.
- Not to be confused with [`fable-backend-review-2026-07.md`](fable-backend-review-2026-07.md), which is a separate, much smaller list of backend _gaps_ (missing endpoints) surfaced later by the UI stream.

Every finding carries a stable id (`F-001`…`F-173`) assigned in document order. Ids are the
join key between this snapshot and the ledger, so they never change and are never reused, even
when a finding is fixed or refuted.

Two cautions for anyone working from this, both consequences of it being nine days old and
growing older:

- **Line numbers have drifted.** Each finding cites `path/file.ts:LINE` as of 2026-07-01. Locate the code by symbol and by the described mechanism, not by line number.
- **Some of this is already fixed.** Work has continued since the review; a finding being listed here is not evidence that it is still open. That is exactly what the ledger's verification pass is for.

Provenance: the review was written to `docs/research/fable-backend-review-2026-07.md` on
2026-07-02 but never committed, and the UI stream then created its own file at that same path,
overwriting it. This text was recovered on 2026-07-11 from the originating session transcript
by replaying the original write and its six edits in order; every edit anchor matched, so it is
a faithful copy of the report as it stood. The only change made in landing it: the `F-NNN` ids
above, and this header.

---

A Fable 5 re-review of the backend, focused on the gap-period work: a correctness audit of
what is built plus a development roadmap. Every finding here is a **logged work item, not an
applied fix** — the review changes no product code. Method: one Fable reviewer per area, and
every finding adversarially verified refute-by-default by a second, independent Fable agent
(severities below use the verifier's corrected value where it adjusted the reviewer's).
Dated 2026-07-01; **all three waves complete 2026-07-02** — Phase 0 (bedrock), Phase 1 (core
domain), and Phase 2 + cross-cutting, followed by the development roadmap (Artifact B) and the
owner decision batch above.

Severity legend: findings are listed per area in descending severity; CONFIRMED means the
verifier reproduced or fully traced the defect, PLAUSIBLE means the mechanism is real but the
impact assessment was not fully substantiated. REFUTED findings are omitted (counts noted).

## Owner decision batch

Every decision the review surfaced that needs an owner call, with enough context to answer in
one reply. Fixes are **logged, not applied** — these choose sequencing and the shape of the
fix, not whether to do the work. Each carries a recommendation; number references point at the
per-area findings below.

1. **Trust 3·2 corpus — commit the ~79 MB corpus + profiles to git, on a dedicated branch?**
   The 56-jurisdiction provenance-carrying dataset (`docs/research/trust-rules/sources/` +
   `profiles/`) is uncommitted working state (currently in the working tree, untracked). The
   3·2 handover recommends a dedicated branch. It is both the requirements substrate for the
   3·2 build and — per the growth backlog — a potential product surface.
   **Recommendation:** yes, commit to a dedicated `trust-rules-corpus` branch (keeps `main`
   history light, preserves the regenerable pipeline + provenance, and unblocks the 3·2 design
   pickup). Do the N/A-label cleanup pass named in the handover first so the committed dataset
   is the clean one.

2. **Matters numbering fix — allocation table vs. all-segments-scoping.** Two confirmed highs
   (matters §matter-service.ts:245 counter race, §matter-statements.ts:80 double-open clobber)
   share one root: the `matter_number` UNIQUE backstop is render-accurate, not scope-accurate,
   so a scheme with a non-scoping variable segment lets two concurrent draws commit the same
   counter value. Option A: a `matter_number_allocation` table with `UNIQUE(scope_key,
counter_value)` + `UNIQUE(matter_id)` inserted inside the draw batch (the codebase's own
   assert-inside-the-batch idiom; closes both highs regardless of rendered string). Option B:
   require every variable segment to be scoping — changes product semantics (a firm can no
   longer put a non-scoping token in a number).
   **Recommendation:** Option A. It is the smaller change, preserves numbering flexibility, and
   matches the existing idempotency-record pattern; add a contention test with a non-scoping
   variable segment.

3. **Scan-worker extraction — finish the switchover, and how are scan containers distributed?**
   Two coupled calls. (a) The `apps/scan-worker` extraction is half-done and uncommitted on the
   current branch; the standing architecture rule extracts Container subsystems to dedicated
   workers. (b) Confirmed **high** (scan §index.ts:40): every scan routes to a single container
   DO named `"scan"`, so `max_instances: 5` is unreachable — concurrent full-size scans pile on
   one standard-1 instance (OOM / queue-backup risk). Fix is `getRandom(env.SCAN_CONTAINER, N)`
   (or sharded ids) with a warm-poke per instance — OR deliberately document scanning as
   single-instance and lower `max_instances` to 1.
   **Recommendation:** finish the extraction (it also fixes the telemetry console-ban scan-root
   gap, Phase 0), and switch to `getRandom`-style distribution — the horizontal-throughput plan
   the engine's own comments assume is impossible under a named singleton. Do not ship the
   documented-singleton alternative; it contradicts the design intent.

4. **file-manager default upload policy — CRITICAL, fix before any real firm uploads.**
   Confirmed **critical** (file-manager §upload-policy.ts:29): the default allow-list's OOXML/
   ODF patterns use a `.*` suffix the matcher never treats as a wildcard, so every Word/Excel/
   PowerPoint/OpenDocument upload is refused at presign and quarantined at the gate — a legal
   product that cannot accept a `.docx`. This is a no-decision "must fix," but it is called out
   here so it is scheduled first. Paired high (§ingest-core.ts:147): strict sniffed-vs-declared
   MIME equality quarantines every legacy `.doc/.xls/.ppt/.msg` (`application/x-cfb`).
   **Recommendation:** top of the remediation backlog; honor a trailing `.*`, add a
   sniffed/declared equivalence table, and add gate tests running the real default policy
   against docx/xlsx/pptx/odt/doc/msg/pdf fixtures.

5. **custom-fields Convert re-scaling — how to remediate the 100x monetary corruption.**
   Confirmed **high** (custom-fields §convert.ts:169): `applyConvert` never applies
   `number_scale` re-scaling for number↔currency conversions despite the comment claiming it
   happens at apply time, so a converted field permanently mixes two scales (500 reads as $5.00
   while new writes store $500 as 50000). Fix direction: re-scale by 10^(targetScale −
   sourceScale) in `applyConvert`, write the post-convert `number_scale` in the same batch, pin
   a round-trip test.
   **Recommendation:** fix now with a round-trip test; also gate the companion definition-blind
   value write (§custom-field-value-service.ts:56) in the same pass — both sit on the same
   trust boundary. No Convert should be offered on real data until this lands.

6. **Remediation sequencing — fix-first vs. continue features.** The three waves logged 1
   critical + ~28 confirmed highs across the built surface. The owner's stated goal is "make
   sure current offerings are correct in form and function," which argues for a fix-first pass
   before new slices (3·4 billing, etc.).
   **Recommendation:** a bounded fix-first sprint on the critical + the data-integrity and
   tenancy highs (decisions 2, 4, 5, plus worker-files bucket split #10, byte-swap #9,
   directory-merge trio #12, shipping tenancy/financial highs #13), then resume feature work.
   Pure pre-integration items (conversion tree-shake, PDF/metadata engines not yet wired to a
   route) can be fixed as their consuming slice opens rather than up front.

7. **`allocate()` distribution contract (money).** Confirmed medium: `allocate()` documents a
   largest-remainder split but dinero.js 2.0.2 assigns leftover minor units to the largest
   weight, so weighted settlement splits systematically favor the larger party and cannot be
   defended as "largest remainder" under audit. Decision: implement the largest-remainder rule
   in-house at the seam, **or** document the actual (largest-weight) rule as firm policy and pin
   the divergent case in a test.
   **Recommendation:** implement largest-remainder in-house — it is the rule the docstring (and
   most legal fee-split expectations) promise, and the seam is already isolated. Add the missing
   input validation (finite non-negative weights, at least one positive) in the same change.

8. **Telemetry "reached" middleware (the one production-path high in Phase 0/wave 3).**
   Confirmed **high** (telemetry/inference-analytics §reached-middleware.ts:40): a transient D1
   error in the post-`next()` consent read/emit propagates to `onError` and replaces an
   already-committed 2xx with a 500 — analytics failure breaks the user's mutation, violating
   the package's own fail-closed invariant. (Same defect appears in both the telemetry and the
   inference/usage areas — one fix.)
   **Recommendation:** wrap the whole post-`next()` block in try/catch (report through the
   operation logger, never emit on error), move the work to `waitUntil`, make `emitUsage`
   never-throw at its boundary, and add a rejecting-resolver test. Small, high-value; fold into
   the fix-first sprint.

9. **Scan `engineVersion` composition.** Confirmed medium (scan §main.rs:11): `engineVersion`
   is `clamav+yara-x/{lib}+heuristics/1` — the `clamav` token carries no version and the
   signature-DB version is absent, so verdicts a week apart against different signature DBs
   stamp identically and stored "clean" verdicts can't be tied to a signature generation.
   Decision: recompose from three separable data-bearing parts (clamd engine version, ClamAV
   signature-DB version/date, yara ruleset version).
   **Recommendation:** adopt the three-part composition (matches the standing memory note and
   unlocks the signature-refresh re-scan reconciliation growth idea); low effort, high
   evidentiary value for a legal custodian pipeline.

10. **worker-files bucket source-of-truth (presign/read split).** Confirmed **high**
    (worker-files-surface §ingest-consumer.ts:70): the write path presigns against
    `firm.bucketName` (a real per-firm bucket for a REST-provisioned firm) while every read
    path uses the single bound `env.R2` — so every upload for such a firm lands where no read
    path looks and ingest dead-letters. Decision: presign against the bound bucket until
    per-firm bindings exist, **or** build the R2 twin of `resolveFirmDatabase` and flip every
    path in one commit.
    **Recommendation:** the single-bound-bucket option now (matches how every read already
    resolves; add an integration test asserting presign and ingest resolve identically), and
    treat true per-firm R2 bindings as a separate later slice.

11. **Post-commit byte-swap window (worker-files, before any real firm uploads).** Confirmed
    **high** (§ingest-consumer.ts:68): a committed version's bytes stay overwritable for the
    remainder of the 1-hour presigned-PUT TTL, and the overwrite R2 event no-ops — swapped
    bytes are never re-sniffed/re-scanned, served under `scan_verdict='clean'` with a stale
    hash (fatal for chain-of-custody).
    **Recommendation:** store the etag at commit, treat an object-create event on a non-pending
    version as an overwrite (compare etag/sha256 → quarantine or re-ingest), and shorten the
    single-shot PUT TTL to minutes. Data-integrity high — include in the fix-first sprint.

12. **encryption rotation-seam — gate before any second key version or second protected field.**
    Confirmed medium (crypto, downgraded from high only because no rotation can occur today):
    the read path never consults the envelope's stored `keyVersion` (AAD built from a hardcoded
    `firmKeyVersion=1`), so the first real firm-key rotation makes every previously sealed value
    permanently unreadable. Plus empty-plaintext seals but never opens (`protect.ts:23`).
    **Recommendation:** treat "make the envelope authoritative on read + extend the provider to
    `getFirmHkdfKey(firmId, keyVersion)`" as a hard gate on the rotation/BYOK growth work and on
    any second `protected()` field — not optional. Fix the empty-plaintext frame in the same
    pass.

13. **Shipping slice — three financial/tenancy highs before it carries real postage spend.**
    Confirmed highs: EasyPost `Idempotency-Key` is unsupported so a retried purchase after a
    partial failure charges and then 422s forever (§shipping.ts:505); requested insurance is
    silently never bought (§map.ts:165); and the label GET reads `labels/{id}.pdf` from the
    shared bucket with no firm-ownership check — a cross-firm label leak (§shipping.ts:573).
    **Recommendation:** fix all three before enabling live purchase — recover-by-read on the
    remote buy, send EasyPost's `insurance` buy parameter (or 422 until wired), and serve the
    label from the firm-verified row's stored key (prefix keys with firm id while the bucket is
    shared). The connection-health/reconnect items (#F8.4/F8.8) can follow with the
    connection-management UI.

14. **SSRF resolver wiring (whois + safe-browse).** Confirmed medium (§app.ts:309): production
    wires no DNS resolver into any `assertPublicTarget` call site, so the resolved-IP pass — the
    documented DNS-rebinding defense — is inactive; only literal-IP checks run. Coupled: once
    the resolver lands, whois for a lapsed/unregistered domain will 400 unless the resolver is
    kept off the whois _query_ (§lookup.ts:28).
    **Recommendation:** ship the ~15-line DoH resolver and pass it to both call sites, but apply
    it only to connection destinations (safe-browse hops), never to the whois query name.

15. **ai-detection raw-score placement (before the Pangram vendor adapter + UI land).**
    Confirmed medium/low: the normalizer accepts finite out-of-range scores as directional
    verdicts (a percentage-scale adapter bug would report every document "likely AI" at high
    reliability, §normalize.ts:20), and `DetectionReport.score` sits top-level beside `band`,
    guarded only by a comment (§report.ts:50) so a UI is one property access from rendering
    "92% AI-generated" as fact.
    **Recommendation:** before wiring the first vendor: clamp out-of-range scores to
    `inconclusive`, treat non-finite `vendorConfidence` as low-confidence, and move the raw
    score under `provenance` so `band` is the only top-level quantitative claim. Cheap now,
    expensive to retrofit through a contract + UI later.

## Phase 0 — Correctness audit

Areas reviewed: money, identifiers, database, data-access, ledger, encryption,
access-control, telemetry, worker-chokepoint. Results below are from the pure-Fable run
(nine complete area reviews, 45 findings verified 1:1; an earlier limit-killed partial pass
of four areas was deduplicated into these results — every surviving early finding was
independently re-found and re-verified by the complete rerun).

### money — Fable-grade with reservations

Single-file dinero seam (fitness-test enforced), compile-time Money/Rate/Ratio/Intermediate
branding, fail-loud safe-integer guards at every constructor and at collapse, exact-string
Intl formatting verified near 2^53, and a differential suite against decimal.js at the
.5-cent boundaries — all empirically confirmed to hold. The reservation is `allocate()`: its
documented distribution contract is not what the library implements, and it is the one
numeric boundary with no input validation.

- `F-001` **Medium (CONFIRMED, downgraded from high)** — financial — `packages/money/src/allocate.ts:7` —
  `allocate()` documents a largest-remainder split but dinero.js 2.0.2 assigns leftover minor
  units to the largest weight, not the largest fractional remainder. Failure: `allocate($0.09,
[3,4])` returns [3¢, 6¢] where true largest-remainder gives [4¢, 5¢] (reproduced); weighted
  settlement splits systematically favor the larger party and the split cannot be defended as
  "largest remainder" under audit. Fix: implement the distribution in-house at the seam
  (floor shares + remainder by descending fractional remainder), or document the actual rule
  as policy and pin the divergent case in a test.
- `F-002` **Medium (CONFIRMED)** — correctness — `packages/money/src/allocate.ts:7` — `allocate()` is
  the only numeric boundary with no validation: a non-finite weight silently yields an even
  split, and the remainder loop is O(amount). Failure: an upstream `balance/totalBalance`
  with zero total yields Infinity and the payment splits 50/50 across invoices with no error
  (reproduced); large amounts can blow the Workers CPU limit. Fix: require finite,
  non-negative weights with at least one positive; throw a RangeError naming the offending
  weight.
- `F-003` **Medium (CONFIRMED)** — financial — `packages/money/src/money.ts:62` — the currency
  registry promises "a new currency is a one-line addition" but every path hard-assumes
  exponent-2. Failure: registering JPY per the comment silently mis-scales every amount by
  100x with nothing throwing. Fix: assert `currency.exponent === MONEY_SCALE` at registration
  and correct the comment.
- `F-004` **Low (CONFIRMED)** — quality — `packages/money/src/money.ts:79` — `money()`/`fromMinor()`
  accept -0, contradicting the package's own "-0 must never leave the package" invariant
  (guarded in `fromDecimal` and `negate` only). Fix: normalize zero in `money()`.
- `F-005` **Low (CONFIRMED)** — quality — `packages/money/src/money.ts:169` — `decimalToScaled()`
  skips the safe-integer assert, so an over-precise quantity fails later at collapse blaming
  "money amount" instead of the quantity. Fix: `assertSafeInteger(amount, "quantity")` at the
  boundary.

Refuted: 0.

### identifiers — Fable-grade

Crypto core correct (126-bit tokens, no modulo bias, CSPRNG default, seeded source provably
untouched by production code); prefix registry provably unambiguous and test-enforced; the
retry idiom's contract is right and well-tested. The one concern is truth drift, not
correctness: a comment documents consumers that do not exist.

- `F-006` **Low (CONFIRMED)** — quality — `packages/identifiers/src/generate.ts:31` — the doc comment
  on `generateUniqueIdentifier` claims it is "reused by idempotency and the outbox"; both mint
  ids with bare `newIdentifier` and never retry — the helper has zero production call sites.
  Failure: a developer models new UNIQUE-insert error handling on retry behavior that is not
  there. Fix: wire the named consumers through the helper, or rewrite the comment to state
  the truth.
- `F-007` **Low (CONFIRMED)** — quality — `packages/identifiers/test/registry.test.ts:23` — test name
  carries a backward-looking "(slice 0·6)" citation the process-reference lint deliberately
  leaves to review. Fix: rename to describe the fact.

Refuted: 1 (unbounded untrusted string in `assertIdentifier`'s error message — the error
pipeline already caps `messageHead` at the logging boundary).

### database — Fable-grade with reservations

The migration core is strong: pending-computation/transport seam, migration + `_migrations`
record in one atomic D1 batch, fail-loud on schema-newer-than-code, correct
`PRAGMA defer_foreign_keys` hand-fix, and exemplary schema fitness functions (no REAL
columns, money suffixes, tenancy split, seed-registry conformance). The reservation is
operational: the fleet rollout orchestrator is a pure function nothing invokes, and the
control-plane lineage has no production application path at all.

- `F-008` **Medium (CONFIRMED, downgraded from high)** — correctness —
  `packages/database/src/fleet-rollout.ts:36` — `rolloutMigrationsAcrossFleet` has no
  production caller (no cron/Workflow trigger, no lazy-on-connect catch-up); only the
  provisioner runs per-firm migrations. Failure: at firm #2, every deploy that adds a per-firm
  migration breaks all previously provisioned firms with `no such column` until manual
  re-provisioning. Downgraded because the fleet is one firm today. Fix: wire a scheduled
  trigger over the control-plane firm registry, and/or a lazy head-check in
  `resolveFirmContext` that runs pending migrations on mismatch.
- `F-009` **Medium (CONFIRMED)** — correctness — `apps/worker/src/firm-provisioner-wiring.ts:23` —
  the control-plane lineage has no production application path or head-check; the only runner
  lives in test support. Failure: a control-plane migration plus auto-deploy leaves
  auth/provisioning queries failing mid-request until an operator remembers the manual step.
  Fix: bundle the control-plane lineage into the worker and run it deploy-time or at the top
  of the scheduled sweep; at minimum add a fail-loud head-check.
- `F-010` **Medium (CONFIRMED)** — quality — `packages/database/test/expand-contract.test.ts:50` —
  the `-- contract:` annotation is checked per file, not per statement; one marker exempts
  every destructive statement in the file. Failure: an unnoticed `DROP COLUMN` bundled into an
  annotated migration ships unreviewed and destroys data fleet-wide. Fix: test the marker per
  statement segment (the three committed annotated files already comply).
- `F-011` **Low (CONFIRMED)** — correctness — `packages/database/src/d1-migration-target.ts:8` —
  `_migrations` tracks tag only, no content checksum, so an edited already-applied migration
  file diverges silently between firms provisioned before and after the edit. Fix: store a
  content hash in the same atomic batch and fail loud on mismatch.
- `F-012` **Low (CONFIRMED)** — quality — `packages/database/drizzle/per-firm/meta/_journal.json:1` —
  0013_snapshot.json is missing (18 journal entries, 17 snapshots); the backfill commit was
  lost in a later merge. Fix: restore the snapshot and add a fitness test asserting one
  snapshot per journal entry per lineage.

Refuted: 0.

### data-access — Fable-grade with reservations

The hard invariants are right: pre-check → speculative effect → single-batch commit with the
idempotency record first; UNIQUE-conflict rollback with replay-the-winner implemented and
tested; tenancy genuinely sound (per-firm physical isolation, firm-prefixed keys from
authenticated context, fail-loud on missing firm context); protected-write seam fail-closed
with audit-before-plaintext. The reservation is the outbox's operational lifecycle: an
unindexed hot-path scan that degrades without bound, and no purge design.

- `F-013` **Medium (CONFIRMED)** — quality — `packages/database/src/per-firm-schema.ts:97` — no index
  on `outbox.aggregate_key`, so the `MAX(seq)+1` subselect inside every ordered-write
  transaction full-scans the outbox on the request hot path, holding the single-writer lock.
  Fix: add `(aggregate_key, seq)` index as a per-firm migration.
- `F-014` **Medium (CONFIRMED)** — quality — `apps/worker/src/scheduled.ts:249` — dispatched outbox
  rows are never purged (idempotency records get a 24h TTL; outbox has none), and a future
  naive purge is a correctness trap: deleting an aggregate's rows resets seq to 0, making
  skip-stale consumers silently drop all new messages. Fix: add retention now with purge-safe
  seq allocation (high-water-mark row or dedicated counter table) designed first.
- `F-015` **Low (PLAUSIBLE, downgraded from medium)** — correctness —
  `packages/data-access/src/canonical.ts:9` — `sortKeysDeep` rebuilds objects before
  `JSON.stringify`, so `toJSON`-reliant values (Date, URL) and Map/Set serialize as `{}`
  (mechanism reproduced; no current call site passes such values). Failure: a future outbox
  payload carrying `new Date()` stores `{}` silently. Fix: honor `toJSON` before the object
  branch; throw on Map/Set.
- `F-016` **Low (CONFIRMED)** — correctness — `packages/data-access/src/outbox-relay.ts:80` — a
  throwing `deadLetter` callback propagates mid-loop, abandoning the rest of the batch and
  losing the sweep report, contradicting the "failures are per-row isolated" contract. Fix:
  wrap the callback in its own try/catch.
- `F-017` **Low (CONFIRMED)** — correctness — `packages/data-access/src/outbox-relay.ts:61` — the
  mark-dispatched UPDATE shares the publish try block, so a transient database error after a
  successful publish burns the attempts budget and can dead-letter a delivered message. Fix:
  split the catch; a mark failure stays pending without incrementing attempts.
- `F-018` **Low (CONFIRMED)** — correctness —
  `packages/data-access/src/hono-idempotency-middleware.ts:90` — non-JSON bodies fingerprint
  as undefined, so on a future non-JSON mutating route two different payloads under one
  Idempotency-Key replay silently instead of 422. Fix: fingerprint raw body bytes or fail
  loud on non-JSON content types.
- `F-019` **Low (CONFIRMED)** — correctness —
  `packages/data-access/src/hono-idempotency-middleware.ts:106` — replaying a stored
  contentless status (204/205/304) constructs a Response with a body and throws, turning
  every retry into a 500 (reproduced against the installed Hono). Fix: return
  `context.body(null, code)` for null-body statuses.

Refuted: 0.

### ledger — Fable-grade with reservations

Very strong for a financial core: layered double-entry enforcement (validation codes → schema
CHECKs → UNIQUE reversal index → table-wide fitness re-proof), a correct float-exactness
argument, D1's no-interactive-transaction reality respected everywhere, and tests that
exercise the invariants (double-reversal race, trust-overdraw CHECK abort) rather than happy
paths. The reservation is the reversal dating gap.

- `F-020` **Medium (CONFIRMED)** — financial — `packages/ledger/src/reverse-entry.ts:44` —
  `reverseEntry` loads the original entry but never compares dates, so a reversal can be
  effective-dated before the entry it reverses. Failure: a backdated reversal creates as-of
  windows showing a phantom negative on a client trust sub-ledger — the exact period-integrity
  class the dual-date design exists to prevent; the balance CHECK cannot catch it. Fix: refuse
  `input.effectiveDate < original.effective_date` with a named code (the row is already
  fetched; one comparison).
- `F-021` **Low (CONFIRMED)** — correctness — `packages/ledger/src/fitness.ts:26` — the fitness
  harness misses two corruption classes the write path treats as fatal: accounts with lines
  but no balance row, and entries with zero lines. Fix: add the two LEFT JOIN / NOT EXISTS
  queries to `FITNESS_STATEMENTS`.
- `F-022` **Low (CONFIRMED)** — financial — `packages/ledger/src/statements.ts:105` — the exactness
  cap is per entry; nothing bounds the cumulative materialized balance, which can pass 2^53
  and silently round on every JavaScript read. Fix: CHECK on `account_balance.balance_minor`
  within the safe-integer range; assert `Number.isSafeInteger` at the read boundary until the
  migration lands.

Refuted: 0.

### encryption — Fable-grade with reservations

A disciplined pure-crypto core: non-extractable keys end to end, single audited IV source,
purpose/index key separation, an AAD mismatch matrix test, committed golden vectors, and
honest documentation of accepted tradeoffs. The reservation is serious and must be closed
before any second key version or second protected field ships: the rotation story the
envelope exists to tell is currently fiction, and empty plaintexts seal but never open.

- `F-023` **Medium (CONFIRMED, downgraded from high)** — crypto —
  `packages/data-access/src/protected-fields.ts:194` — the read path never consults the
  envelope's stored keyVersion: the AAD is built from `context.firmKeyVersion` (hardcoded 1
  everywhere) and the key provider is version-blind (it even reads `firm_key_version` from D1
  and discards it). Failure: the first real firm-key rotation makes every previously sealed
  value permanently unreadable, indistinguishable from corruption. Downgraded because no
  rotation can occur today. Fix: make the envelope authoritative on read (decode first, build
  the decrypt AAD from stored versions, extend the provider to
  `getFirmHkdfKey(firmId, keyVersion)`); add a seal-rotate-read test.
- `F-024` **Medium (CONFIRMED, downgraded from high)** — crypto —
  `packages/encryption/src/protect.ts:23` — sealing an empty string succeeds but produces a
  30-byte frame `decodeEnvelope` rejects (minimum 31): write-succeeds/read-fails-forever,
  reproduced empirically; each later read also commits a decrypt audit row before throwing.
  Only one route's zod `min(1)` currently prevents it. Fix: reject empty plaintext with a
  typed error or lower the minimum frame length; add the empty-string case to the tests.
- `F-025` **Medium (CONFIRMED)** — crypto — `packages/data-access/src/firm-key-provider.ts:51` —
  crypto-shred converges only within the isolate that executed it: the key cache has no TTL,
  so other live isolates keep serving the shredded firm's key indefinitely. Failure: a
  legal-product destruction guarantee is quietly false for an unbounded window after the
  audit row asserts the corpus is unreadable. Fix: short TTL on cached entries (re-unwrap is
  cheap; a nulled row then fails closed platform-wide); document the convergence bound.
- `F-026` **Low (CONFIRMED)** — crypto — `packages/encryption/src/envelope.ts:98` — `decodeEnvelope`
  accepts keyVersion 0 that `encodeEnvelope` refuses to produce, and decrypt never
  cross-checks the decoded header against the caller's AAD — the stored version byte is
  effectively unauthenticated, which matters the moment the rotation fix makes it a
  key-selection input. Fix: validate the byte on decode and assert header/AAD agreement
  before decrypting.

Refuted: 1 (delimiter-injection collision in the colon-joined derivation strings — accurate
string algebra, but every real call path parses at the first colon, making the colliding
inputs unreachable).

### access-control — Fable-grade with reservations

The RBAC spine is strong: branded Permission type, fail-closed resolver dropping unknown
keys, deactivated members double-gated, registration-time rejection of unregistered
permissions, conservative role seeding. The reservation is the public-surface seam: the most
dangerous route in the system is protected by per-route middleware discipline in an
architecture whose stated point is eliminating exactly that.

- `F-027` **Medium (CONFIRMED, downgraded from high)** — security —
  `apps/worker/src/contracts/route-meta.ts:154` — nothing ties `surface: "public"` to the
  chokepoint's authn/RBAC skip: a public-surface route's `authenticated`/`permission` meta is
  dead metadata, and the three guard layers each key off a different field. Failure: a future
  public-surface route with the platform-admin guard forgotten (or dropped in a refactor)
  passes every definition-time assert and conformance rule, then serves anonymous traffic
  while its meta claims RBAC; `firms.provision` already exhibits the dead-metadata shape.
  Fix: definition-time assert that public surface requires `authenticated: false` and
  `permission: null`, with the platform-admin guard modeled as explicit meta the chokepoint
  composes itself.
- `F-028` **Medium (CONFIRMED)** — security — `packages/access-control/src/resolver.ts:29` —
  `effectivePermissions` fails open on a malformed or non-canonical direct-grant
  `expires_at`: any string sorting lexicographically after `now` is unexpired forever, and
  the comment's claimed write-path guardrail does not exist (no production code writes
  `direct_grant`; no CHECK constraint). Failure: an offset-form ISO timestamp keeps an
  expired sensitive grant alive; garbage grants it permanently. Fix: validate the fixed-width
  canonical form in the resolver and treat non-conforming values as expired; add the CHECK.
- `F-029` **Medium (CONFIRMED)** — correctness —
  `packages/database/test/generated-migrations.test.ts:295` — the seed-permission fitness
  function silently skips any seed INSERT whose statement chunk begins with an SQL comment —
  the repo's dominant seed style; 8 of 47 committed role_permission seeds are unchecked
  today, including both customFields seeds (reproduced). Failure: a typoed permission key
  under a leading comment ships CI-green and the resolver silently drops it firm-wide. Fix:
  strip leading comment lines before the INSERT test, handle multi-row VALUES, and add a
  meta-assertion that parsed-count equals raw-scan count.
- `F-030` **Low (CONFIRMED)** — quality — `apps/worker/src/contracts/route-meta.ts:20` — the
  `RouteMeta.permission` doc comment states the security rule backwards ("null only when
  authenticated: false"), contradicting the enforced guards and live routes. Fix: state the
  real rule, including that null on an authenticated read means any active firm member.

Refuted: 0.

### telemetry — needs remediation

The structural redact-by-default design (typed allowlist builders, runtime key-stripping,
scrub backstop with a tripwire metric, one console site fitness-enforced, fail-closed HMAC
pseudonymization, k-anonymity suppression) is well conceived and well tested. But one
confirmed high sits on the production request path, and three asymmetries leave gaps in the
defense-in-depth the design promises.

- `F-031` **High (CONFIRMED)** — correctness — `apps/worker/src/usage/reached-middleware.ts:40` — the
  usage "reached" middleware runs its consent D1 read and emit after `next()` with no error
  boundary, so a transient analytics failure replaces an already-successful response —
  including committed writes — with a 500. Directly contradicts the package's documented
  fail-closed invariant, and puts a D1 read on the response hot path; the same fragility
  exists at the outbox sweep's completion emit. Fix: try/catch everything after `next()`
  (report through the operation logger), move the work to `waitUntil`, and make `emitUsage`
  never-throw at its own boundary.
- `F-032` **Medium (CONFIRMED)** — security — `packages/telemetry/src/event.ts:36` — the runtime
  defense strips undeclared keys but not non-primitive values: an object smuggled through an
  `any`-typed declared field is JSON.stringify'd into the log line with all nested content,
  bypassing allowlist and scrubber (reproduced). Fix: runtime-enforce FieldValue in the build
  loop (keep primitives, drop or stringify-and-scrub the rest, bump a tripwire).
- `F-033` **Medium (CONFIRMED)** — security — `packages/telemetry/src/workers-logger.ts:30` —
  `Logger.count()` is a completely unguarded emission path: free-form metric names and
  dimension values reach Analytics Engine with no allowlist, no scrub, no tripwire. Fix:
  scrub every dimension value and count trips; longer-term, a declared metric catalog
  matching the event-side posture.
- `F-034` **Medium (CONFIRMED)** — security — `packages/telemetry/src/scrub.ts:13` — the scrub
  denylist misses space/dash-separated card numbers and phone shapes, so canonical PII in
  `messageHead` (the one free-text field) passes verbatim with the tripwire silent
  (reproduced). Fix: add separated-group and phone patterns with planted tests.
- `F-035` **Medium (CONFIRMED)** — quality — `packages/telemetry/test/console-ban.test.ts:30` — the
  console-ban fitness function hardcodes `apps/worker/src` + `packages/*/src`, so
  `apps/scan-worker/src` — and every future extracted worker app — is outside the
  one-logging-path enforcement. Fix: enumerate `apps/*/src`, excluding `apps/web/src` by name
  with a comment if intended.
- `F-036` **Low (CONFIRMED)** — reuse — `packages/telemetry/src/scrub.ts:23` — `OPAQUE_HANDLE`
  hardcodes the 21-char token length and alphabet that `@magna-carta/identifiers` exports as
  the source of truth. Fix: build the regex from `TOKEN_SIZE`/`identifierPattern`.
- `F-037` **Low (CONFIRMED)** — quality — `packages/telemetry/src/workers-logger.ts:31` — `count()`
  encodes dimensions as positional `Object.values()` blobs: the Analytics Engine column
  contract is each call site's object-literal key order, unchecked. Fix: declare each
  metric's ordered dimension-key tuple once and lay out blobs from it.
- `F-038` **Low (CONFIRMED)** — quality — `packages/telemetry/src/ids.ts:2` — four backward-looking
  process-artifact comments (ids.ts:2, workers-logger.ts:1-2, operation.ts:1, events.ts:79)
  of the kind the mechanical lint deliberately delegates to review. Fix: rewrite each to
  state the reasoning or point to a file by path.

Refuted: 0.

### worker-chokepoint — Fable-grade with reservations

Very close to Fable-grade and better documented than most enforcement layers: proven gate
order, canonical RFC 9457 problems, no existence oracle, read-only idempotency pre-decision,
server-derived tenant-scoped rate keys, fail-closed-on-throw pinned by tests, firm always
from the session. The reservation: the central "every route traverses the chokepoint"
promise is enforced by convention at ~89 hand-written call sites while the fitness function
checks the wrong proxy.

- `F-039` **Medium (CONFIRMED, downgraded from high)** — security —
  `apps/worker/test/conformance.test.ts:385` — the "every /api/v1 route composes the
  chokepoint" fitness function proves only OpenAPI-document membership; chokepoint
  composition is a separate manual `middleware:` spread per route. Failure: one forgotten
  spread on a context-free route (e.g. whois) ships an unauthenticated, un-rate-limited
  endpoint through green CI — no startup throw, no failing test. Fix: make composition
  structurally provable (brand/record composed routes and assert over `app.routes` at
  startup), or a registration helper that always injects the chokepoint.
- `F-040` **Low (CONFIRMED, downgraded from medium)** — security — `apps/worker/src/routes/platform/firms.ts:77` —
  the platform-admin secret guard runs before the rate-limit gate, so failed
  X-Platform-Admin-Key attempts are never throttled (only correct-key requests ever charge
  the bucket), leaving the provisioning credential open to unbounded online brute force and
  free telemetry flooding. Fix: charge an IP-keyed bucket on the denial path inside the
  guard, keeping the opaque 401.
- `F-041` **Low (CONFIRMED)** — tenancy — `apps/worker/src/chokepoint/ports.ts:81` —
  `resolveFirmContext` never reads `firm.status`, so a provisioning (or future
  suspended/offboarded) firm resolves as fully present at the single enforcement point;
  unreachable today only by a provisioner invariant two files away. Fix: add
  `AND status = 'active'` so non-active firms fold into the structural-absence 404.
- `F-042` **Low (CONFIRMED)** — quality — `apps/worker/src/chokepoint/chokepoint.ts:220` — replays
  are fully exempt from rate limiting: looping one Idempotency-Key gets unlimited D1-backed
  replays that never debit a bucket, and the pre-decision D1 read runs even for already-429'd
  clients. Fix: debit the bucket on the replay/conflict short-circuit paths.

Refuted: 1 (idempotency-port comment's claimed definition-time guard — the guard is indeed
absent, but the misconfiguration fails closed per-request, so the impact claim did not
survive).

### STATUS.md marker clearance (Phase 0)

The review's clearance rule: a slice's Fable-re-review marker (`*` or `↻`) can clear only if
the review found nothing above low severity in that slice's surface.

| Slice                                                                    | Marker                              | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0·4 — Auth + RBAC skeleton + firm provisioning                           | `[x] Opus 4.8 ↻` (Built)            | **Stays flagged.** Blocking: the public-surface enforcement seam (`route-meta.ts:154`, medium), the fail-open direct-grant expiry compare (`resolver.ts:29`, medium), and the comment-skipping seed-permission fitness function (`generated-migrations.test.ts:295`, medium). The chokepoint's unthrottled platform-admin guard (`firms.ts:77`, low) and status-blind firm resolution (`ports.ts:81`, low) are non-blocking but sit in the same surface.      |
| 0·5a — API contract foundation                                           | `[x]*` (Built)                      | **Stays flagged.** Blocking: the contracts layer carries the public-surface guard gap (`route-meta.ts:154`, medium) — the definition-time asserts are the layer under review.                                                                                                                                                                                                                                                                                 |
| 0·5b — API contract enforcement + pipeline                               | `[x]*` (Built)                      | **Stays flagged.** Blocking: the chokepoint-composition fitness function proves the wrong proxy (`conformance.test.ts:385`, medium) — the enforcement pipeline's central promise is unverified by its own conformance corpus.                                                                                                                                                                                                                                 |
| 0·6 — Telemetry baseline + platform closeout                             | `[x] Opus 4.8*` (Built)             | **Stays flagged.** Blocking: the confirmed high (usage "reached" middleware converts analytics failures into customer-visible 500s, `reached-middleware.ts:40`) plus four mediums (object-value allowlist bypass, unguarded `count()` path, separated-digit scrub miss, console-ban scan roots).                                                                                                                                                              |
| 0·2 / 0·3 — money, identifiers, database, data-access, ledger + fixtures | no markers (Fable-built originally) | **New logged items, no marker to clear.** The mediums above (allocate contract/validation, currency exponent, fleet-rollout and control-plane wiring, expand-contract per-file waiver, outbox index/retention, reversal dating) enter the remediation backlog as new work items against otherwise Fable-grade foundations. Encryption's rotation-seam and empty-plaintext mediums likewise — with the rotation fix gated before any second key version ships. |

## Phase 1 — Correctness audit

Areas reviewed: matters, locations, file-manager, worker-files-surface, directory,
custom-fields, fixtures-harness — the Phase 1 domain slices (1·1, 1·3, 1·4) plus the worker
file surface and the cross-cutting load-profile harness; slice 1·2 (encryption) was already
covered under Phase 0's encryption area. Seven complete area reviews produced 68 findings;
the verification pass spans resumed runs (108 verifications total), so each finding below
carries its latest verdict: 64 CONFIRMED, 2 PLAUSIBLE, 2 REFUTED. The recurring pattern
across areas is tests-only-test-what-they-were-pointed-at: the architecture and tenancy
discipline consistently hold, while lifecycle edges, concurrency windows, and the actual
documents/values a law firm handles were never driven end-to-end.

### matters — needs remediation

Largely code Fable would have built: clean statement-builder/service split, a genuinely
well-designed transactional-outbox + idempotency primitive, reasoning-bearing comments, and
exactly the right schema-name-sync/migration fitness paranoia. The failure is the concurrency
story: the matter_number UNIQUE backstop is render-accurate, not scope-accurate, and the
lifecycle UPDATEs are check-then-batch with no in-batch status guard — and the contention
tests only cover configurations where the backstop happens to fire. One allocation table with
UNIQUE(scope_key, counter_value) + UNIQUE(matter_id) inserted inside the draw batch closes
both highs with the codebase's own assert-inside-the-batch idiom.

- `F-043` **High (CONFIRMED)** — correctness — `packages/matters/src/matter-service.ts:245` — the
  matter_number UNIQUE backstop does not cover the guarded counter when a scheme contains a
  non-scoping variable segment. Failure: two concurrent draws render 'RENO-26-0103' and
  'VEGAS-26-0103' — different strings, no UNIQUE collision — and both commit carrying counter
  value 103 (the loser's guarded increment matches zero rows, and a zero-change UPDATE does not
  abort a D1 batch); the contention suite only exercises schemes where every non-counter
  segment is constant. Fix: a matter_number_allocation table with UNIQUE(scope_key,
  counter_value) inserted in the draw batch, so a loser aborts regardless of the rendered
  string; add a contention test with a non-scoping variable segment.
- `F-044` **High (CONFIRMED)** — correctness — `packages/matters/src/matter-statements.ts:80` —
  openMatterStatement's UPDATE has no `AND status = 'prospective'` guard and the prospective
  check is a separate pre-batch read. Failure: a concurrent double-open (two tabs, two
  client-minted Idempotency-Keys) draws twice and the second commit overwrites the just-frozen
  matter number — the first number lives on in A's response, audit trail, and outbox event but
  belongs to no matter. Fix: add the status guard and make the batch fail loud via the same
  allocation row carrying UNIQUE(matter_id).
- `F-045` **Medium (CONFIRMED)** — correctness — `packages/matters/src/matter-service.ts:410` —
  closeMatter has no status precondition: re-closing an already-closed matter silently rewrites
  closed_at and emits a second matter.closed outbox event. Failure: a June re-close moves a
  January close date — the date driving retention clocks — five months with no trace. Fix:
  refuse status 'closed' with a 409-mapped validation code plus an in-batch `AND status !=
'closed'` belt.
- `F-046` **Medium (CONFIRMED)** — correctness — `packages/matters/src/close-preconditions.ts:18` —
  the close-precondition seam is check-then-act: preconditions run as reads before the commit
  batch and their contract cannot contribute an in-batch guard. Failure: when Phase 3 registers
  the zero-trust-balance rule, a trust deposit racing the close commits after the
  precondition's zero-balance read — a matter closed holding client funds. Fix: extend
  ClosePrecondition to optionally return guard statements composed into the close batch, now,
  while the registry is empty and the contract change is free.
- `F-047` **Medium (CONFIRMED)** — quality — `packages/matters/src/matter-service.ts:508` —
  renumberMatter's audit row carries null metadata, so the displaced number is destroyed with
  no durable record. Failure: a court filing referencing the pre-renumber number a year later
  resolves to nothing anywhere in the system. Fix: record the prior number in the same batch
  (history row or audit metadata — loadMatter already fetched it).
- `F-048` **Low (CONFIRMED)** — correctness — `apps/worker/src/routes/matters/matters.ts:149` —
  serviceClock().today() is the UTC civil date, so year/date_opened segments render the UTC
  date: a Nevada matter opened 5pm on New Year's Eve is permanently numbered into the next
  year. Fix: derive today() from a firm timezone setting; until it exists, document the UTC
  behavior as a decision.
- `F-049` **Low (CONFIRMED)** — correctness — `packages/matters/src/queries.ts:63` — listMatters
  free-text search interpolates the term into LIKE without escaping % and \_, so wildcards
  behave as wildcards ('%' alone matches every matter). Fix: escape the term and append
  `ESCAPE '\'` to the three predicates.
- `F-050` **Low (CONFIRMED)** — quality — `packages/matters/src/matter-service.ts:284` —
  fieldsFromInput ends in `as MatterFields`, waiving the compile-time guarantee that
  responsibleMemberId is present; a future partial-input caller fails at the database's NOT
  NULL instead of the compiler. Fix: remove the cast and require a resolved responsibleMemberId
  in the signature.

Refuted: 1 (the inline route SQL in readColumn/assembleNumberContext "silently returns null"
after a column rename — D1 throws `no such column` loudly, and the slice e2e exercises the
path; the structural statement-module drift is real but the claimed failure mode is not).

### locations — Fable-grade with reservations

Close to the code Fable would have built: the module faithfully follows the house
compose-then-atomic-batch pattern, the replace-set design makes the one-primary and address
invariants race-safe under D1's serialized batches, tenancy is clean, and the
schema-name-sync fitness test is a genuinely good guard — no high defect, no tenancy leak.
The weaknesses are all at edges the tests were not pointed at: soft close is a status flag
with no downstream semantics, the firm-default-Location machinery is half-built (its
close-refusal invariant is currently vacuous), and predictable constraint violations escape
as raw 500s.

- `F-051` **Medium (CONFIRMED)** — correctness — `packages/locations/src/location-service.ts:124` —
  predictable constraint violations (duplicate number_code, duplicate locationId in an
  assignment set, unknown member/location) are neither pre-validated nor mapped. Failure: a
  second office named "RENO" throws a raw UNIQUE error → generic 500 with an Error ID and no
  clue why. Fix: validate in memory / pre-read what needs the database with stable codes,
  keeping the unique index as the race backstop mapped to 409.
- `F-052` **Medium (CONFIRMED)** — correctness — `apps/worker/src/routes/matters/matters.ts:617` — nothing
  anywhere reads location.status: a closed location still accepts new matters, feeds its
  number_code into fresh matter numbers, and takes new primary-office assignments — and its
  number_code occupies the unique index forever. Fix: enforce close semantics where new
  references are created; free the code on close or scope the unique index `WHERE status =
'active'`.
- `F-053` **Medium (CONFIRMED)** — correctness — `packages/locations/src/settings.ts:9` — the
  firm-default-Location machinery is half-built: no production write path for the setting
  exists, so the close-refusal guard never fires (an admin can close every office), and the
  spec-promised numbering fallback is unimplemented (a location-segment scheme 422s instead of
  falling back). Fix: ship the settings write route and resolve a null matter locationId
  through the firm default in assembleNumberContext; until then add a
  cannot-close-the-last-active-location floor.
- `F-054` **Low (CONFIRMED, downgraded from medium)** — correctness —
  `packages/locations/src/location-service.ts:199` — the firm-default close refusal is a pure
  TOCTOU pre-read with no in-batch assertion, so a concurrent set-default and close can close
  the firm-default location once the settings write path exists. Fix: make
  closeLocationStatement conditional on the setting inside the batch (NOT EXISTS subquery) and
  fail on zero changes.
- `F-055` **Low (CONFIRMED)** — correctness — `packages/locations/src/location-service.ts:166` —
  updateLocation's read-merge-write with a static full-row UPDATE silently loses concurrent
  field updates (both PATCHes return 200; one is reverted). Fix: optimistic updated_at guard or
  narrow the UPDATE to patched columns.
- `F-056` **Low (CONFIRMED)** — quality —
  `packages/database/drizzle/per-firm/0004_matters-locations-file-manager.sql:162` — the
  exactly-one-primary-per-member invariant has no schema backstop, unlike the module's other
  invariants. Fix: partial unique index `ON member_location (member_user_id) WHERE is_primary
= 1` in the next per-firm migration.
- `F-057` **Low (CONFIRMED)** — reuse — `apps/worker/src/routes/matters/locations.ts:520` — the GET
  detail/list handlers inline raw location SQL duplicating selectLocationStatement, invisible
  to the schema-name-sync fitness test that pins every other location statement. Fix: move the
  reads into statements.ts and cover them.
- `F-058` **Low (CONFIRMED)** — quality — `apps/worker/src/routes/matters/locations.ts:40` — numberCode and
  the letterhead text fields have no format or length bounds: empty-string numberCode is
  accepted (and occupies the unique index); a multi-megabyte addressBlock lands in D1. Fix:
  zod min/max/charset constraints mirrored by a service-side non-empty rule.

Refuted: 0.

### file-manager — needs remediation

The architecture is genuinely strong — a uniformly enforced status gate (with a fitness test
rejecting ungated file_version SELECTs), quarantined/pending versions unreachable from every
serving path, correct two-layer ingest idempotency, a monotonic current-version pointer, and
firm-scoped reconciliation. Tenancy rests on physical per-firm isolation and holds. But the
top finding is disqualifying for a legal product: the default upload policy cannot match any
Office document — the ingest gate was never tested against the actual documents a law firm
uploads. The second tier is lifecycle-edge softness: unconditional commit-batch statements, R2
orphans with no deletion path, mutations blind to soft-delete, dead-letters stranding versions.

- `F-059` **Critical (CONFIRMED)** — correctness — `packages/file-manager/src/upload-policy.ts:29` —
  the default allow-list's OOXML/ODF patterns use a `.*` suffix the matcher never treats as a
  wildcard (only `/*` expands), so Word/Excel/PowerPoint/OpenDocument uploads are refused at
  presign and quarantined at the ingest gate. Failure: uploading brief.docx with the standard
  browser MIME gets a 422 "content type is not allowed" (reproduced empirically); no test
  exercises checkUploadPolicy with any Office type. Fix: honor a trailing `.*` (or normalize
  the patterns) and add gate tests running the real default policy against
  docx/xlsx/pptx/odt/doc/msg/pdf fixtures.
- `F-060` **High (CONFIRMED)** — correctness — `packages/file-manager/src/ingest-core.ts:147` — the
  gate's strict sniffed-vs-declared MIME equality plus an allow-list missing container types
  quarantines legitimate files: every legacy .doc/.xls/.ppt/.msg sniffs as
  `application/x-cfb` (verified) and is quarantined either as type-mismatch or policy-type;
  benign variants (image/jpg vs image/jpeg, OOXML sniffed as zip) false-quarantine too. Fix:
  an equivalence table for sniffed/declared families, accept the container types, quarantine
  only genuinely contradictory pairs.
- `F-061` **Medium (CONFIRMED)** — financial — `apps/worker/src/routes/files/uploads.ts:617` — no path ever
  deletes R2 objects for abandoned outcomes (hash-skip duplicates, aborted PUT-mode sessions,
  expired PUTs). Failure: a re-uploaded 4 GB deposition video's bytes stay in R2 forever,
  invisible to the meter (reconciliation deliberately excludes non-clean keys) while accruing
  real storage cost; quarantined objects have no retention policy either. Fix: delete in the
  abandoning flows or add an orphan janitor over the reconciliation LIST; document quarantine
  retention.
- `F-062` **Medium (CONFIRMED)** — security — `packages/file-manager/src/zip-composition.ts:52` — ZIP
  entry paths are composed from raw user-supplied file/folder names; `/`, `\`, and `..`
  segments flow into the archive unsanitized. Failure: a file named `..\..\Startup\evil.docm`
  in a delivered matter ZIP writes outside the extraction directory on non-hardening
  extractors (zip-slip against clients/opposing counsel). Fix: sanitize segments at
  composition and constrain names at the API schema.
- `F-063` **Medium (CONFIRMED)** — correctness — `packages/file-manager/src/file-service.ts:73` —
  requireFile loads deleted_at but never checks it, so rename, move, type assignment, new
  version upload, and re-soft-delete all succeed against a soft-deleted file. Failure: a new
  version is minted, ingested, metered, and made current on a file no read path will ever
  serve; a second delete silently re-stamps the recovery window. Fix: a requireLiveFile guard
  for mutations plus a guarded no-op re-delete.
- `F-064` **Low (CONFIRMED, downgraded from medium)** — correctness —
  `packages/file-manager/src/file-service.ts:320` — only the commit batch's primary UPDATE
  carries the status='pending' guard; the dependent statements (meter delta, current-version
  bump, session status, audit, outbox) run unconditionally, so a lost abort/expiry race
  inflates the meter, can point current_version_id at an abandoned version, and records a false
  committed audit/outbox pair. Fix: make the batch fail as a unit on the unmet precondition or
  carry the correlated guard on every dependent statement.
- `F-065` **Low (CONFIRMED)** — correctness — `packages/file-manager/src/file-service.ts:367` — gate
  quarantines persist a NULL scan_detail: the quarantine reason (type-mismatch / size-mismatch
  / policy-\*) reaches only outbox and telemetry, never the row — the future quarantine-review
  UI cannot tell a malware hit from a size lie. Fix: fall back to the reason when scanDetail is
  null.
- `F-066` **Low (CONFIRMED)** — correctness — `packages/file-manager/src/folder-service.ts:171` — the
  moveFolder cycle check is read-then-batch with no in-batch assertion, so two concurrent cross
  moves can commit a parent cycle that permanently detaches a subtree with no repair path.
  Fix: recursive-CTE guard inside the UPDATE.
- `F-067` **Low (CONFIRMED)** — correctness — `apps/worker/src/files/ingest-consumer.ts:47` — a
  dead-lettered ingest leaves a version 'pending' forever with its session 'completed': no
  sweep matches it, the bytes sit in R2, the user believes the upload succeeded. Fix: a
  stuck-pending detector on the daily pass re-enqueuing an event-shaped message (the
  status-first guard makes the re-drive safe) plus an alert counter.
- `F-068` **Low (CONFIRMED)** — reuse — `packages/file-manager/src/scan-cache.ts:41` — the scan cache
  is write-only: lookupScanCache has no production caller, so the promised scan-once dedup for
  duplicate-heavy imports is structurally unreachable (scanning runs in parallel with hashing).
  Fix: wire the lookup into the hash-first lanes (re-scan sweep, bulk) or trim the comments to
  describe the seam honestly.
- `F-069` **Low (CONFIRMED)** — quality — `packages/file-manager/src/ingest-core.ts:130` — the
  scan-path tee has no backpressure coupling: workerd buffers the delta between the fast hash
  branch and a slower scan branch in isolate memory, so a 1.9 GiB sub-cap object can OOM the
  isolate (retry → repeated OOM → dead-letter); the oversize path's tee-then-cancel is also
  redundant. Fix: pump both consumers chunk-by-chunk from one reader, or bound the sub-cap
  lane; drop the redundant tee.
- `F-070` **Low (CONFIRMED)** — quality — `packages/file-manager/src/folder-service.ts:71` —
  createFolder rejects an empty name with the wrong code ('folder-name-taken'), and
  renameFolder/renameFile skip service-level validation entirely (an empty rename dies as a raw
  D1 CHECK failure → 500; whitespace names pass). Fix: a dedicated 'invalid-name' code with
  consistent trim-validation, mapped in the route translators.

Refuted: 0.

### worker-files-surface — needs remediation

Largely code Fable would have built: real chokepoint discipline, structurally enforced
tenancy (per-firm database handles, firm-scoped Durable Object names, session-derived
tokens), thoughtfully layered idempotency, and a genuinely careful cookieless files.\* edge.
But the lifecycle edges are states nobody drove end-to-end: the three highs — a post-commit
byte-swap window past the scanner, a write/read bucket split that breaks every upload for a
REST-provisioned firm today, and a permanently unrebuildable reaped bundle — plus classic
two-phase-commit idempotency holes on the multipart boundaries. The byte-swap window should
be fixed before any real firm uploads a file.

- `F-071` **High (CONFIRMED)** — security — `apps/worker/src/files/ingest-consumer.ts:68` — a
  committed version's bytes are silently mutable for the remainder of the 1-hour presigned-PUT
  TTL: after ingest commits a version clean, the same presigned URL can overwrite the object,
  and the resulting R2 event no-ops (the pending-status guard matches nothing) — the swapped
  bytes are never re-sniffed, re-hashed, or re-scanned. Failure: malware PUT to the identical
  key minutes after the clean commit is served to every firm member under scan_verdict='clean'
  with a stale hash — fatal for evidence chain-of-custody. Fix: treat an object-create event
  matching a non-pending version as an overwrite signal (compare etag/sha256, quarantine or
  re-ingest on mismatch), store the etag at commit, and shorten the single-shot PUT TTL to
  minutes.
- `F-072` **High (CONFIRMED)** — tenancy — `apps/worker/src/files/ingest-consumer.ts:70` — the write
  path presigns against firm.bucketName (the REST provisioner creates a real per-firm bucket)
  while ingest, inline zip, bundle build, preview serve, and reconciliation all read the single
  bound env.R2. Failure: every upload for a REST-provisioned production firm lands in a bucket
  no read path ever consults — ingest dead-letters, versions stick pending, the queue is
  poisoned with guaranteed-to-fail retries; this is a live write/read split, not an
  un-extended seam. Fix: one source of bucket truth — presign against the bound bucket until
  per-firm bindings exist, or build the R2 twin of resolveFirmDatabase and flip every path in
  one commit, with an integration test asserting presign and ingest resolve identically.
- `F-073` **High (CONFIRMED)** — correctness — `apps/worker/src/downloads/bundle-coordinator.ts:18` —
  a bundle whose artifact was reaped by the bundles/ lifecycle rule can never be rebuilt:
  requestBundle only rebuilds a 'failed' job while the Durable Object stays 'ready' forever.
  Failure: re-requesting the identical selection loops 202 {ready} → poll {expired} →
  re-request, livelocked permanently for that manifest hash. Fix: let the caller force a
  rebuild after observing the artifact missing (artifactMissing flag treating 'ready' as
  'failed'), covered by a DO test.
- `F-074` **Medium (CONFIRMED)** — correctness — `apps/worker/src/routes/files/uploads.ts:571` —
  uploads.complete is not idempotent across its two-phase commit: if R2's
  completeMultipartUpload succeeds but the D1 status flip fails, every retry re-calls the R2
  complete, which now 404s and throws (unlike abort, which tolerates 404). Failure (an earlier
  verify pass refuted the original impact; the rerun traced it end-to-end and confirmed at
  medium): no byte loss — the object-create event still ingests the file — but the client sees
  a permanently failing complete, the session terminates 'expired' instead of 'completed', and
  the upload_completed audit row is never written on an audited route. Fix: on 404 from the R2
  complete, HEAD the session's key and treat an existing object as already-done.
- `F-075` **Medium (CONFIRMED)** — correctness — `apps/worker/src/routes/files/uploads.ts:456` — if the
  deferred createMultipartUpload throws after the idempotency batch commits, the stored 201
  actively blocks repair: a same-key retry replays it and skips the multipart create, leaving
  r2_upload_id null forever and every sign-part a 409. Fix: run the deferred-create repair on
  the replay path too (open session + null upload id → create and store), or self-heal in
  sign-part.
- `F-076` **Low (PLAUSIBLE)** — crypto — `apps/worker/src/files/preview-token.ts:59` — the preview
  delivery token HMACs the bare base64url payload with AUTH_SECRET (shared with Better Auth)
  with no domain-separation tag, so any other artifact ever signed under the same secret whose
  bytes parse as a payload could replay as an object-read credential on the cookieless host.
  Fix: a fixed context prefix in the MAC input, or an HKDF purpose key — two lines while the
  format is young.
- `F-077` **Low (CONFIRMED)** — quality — `apps/worker/src/scheduled.ts:626` — the weekly re-scan
  sweep enqueues up to 100 R2-event-shaped messages per firm that the ingest consumer is
  guaranteed to no-op on (committed versions fail the pending-status guard), re-enqueuing the
  same versions every week forever — dead traffic that will still be no-ops when the real
  engine lands. Fix: gate the sweep on a real engine being resolvable, or land a distinct
  rescan message shape with a committed-version verdict-update path.
- `F-078` **Low (PLAUSIBLE)** — quality — `apps/worker/src/routes/files/uploads.ts:41` — SESSION_TTL_MS /
  STUCK_DEADLINE_MS use the 'MS' shorthand the naming rule forbids while the sibling cron file
  spells MILLISECONDS in full. Fix: mechanical rename.

Refuted: 0.

### directory — needs remediation

Close to the code Fable would have built and better-commented than most human packages: a
genuinely disciplined protected-identifier channel, append-and-flip name history in one
atomic batch with fitness-enforced phonetic codes, an idempotent-replay merge test that
drives the actual commit-race path, and correct FTS5 keyword-collision reasoning. The
concern is that the merge subsystem's guarantees are shallower than its documentation
claims: nothing collapses merge chains, collision absorption hard-deletes user content in
violation of the package's own soft-delete-only invariant, and merged-away subordinates still
accept new references — all invisible to tests that exercise exactly one merge generation
against well-formed inputs, and all in the conflicts corpus where correctness is
non-negotiable. All three are cheap, localized fixes.

- `F-079` **High (CONFIRMED)** — correctness — `packages/directory/src/merge.ts:141` — chained merges
  break merged-entity resolution: merge never re-repoints merged_into_id and every resolution
  path is single-hop, so after A→B then B→C, hits on A's names or SSN surface the archived B
  and never the live master C — a missed conflict in a legal conflicts check; the fitness
  probes omit the merged_into_id columns too. Fix: add the node-table merged_into_id columns to
  REPOINT_TARGETS (collapsing chains at merge time) and to the fitness probes; add a
  chained-merge test.
- `F-080` **High (CONFIRMED)** — correctness — `packages/directory/src/merge.ts:331` — collision
  absorption hard-DELETEs directory_edge and matter_party rows, violating the area's
  soft-delete-only invariant and destroying user-entered content (edge role/note, validity
  windows) the entity_merge event does not record — the merge is not actually reversible for
  absorbed rows. Fix: absorb by soft-delete-and-repoint for tables carrying deleted_at; keep
  the hard delete only for the content-free composite-PK category rows.
- `F-081` **High (CONFIRMED)** — correctness — `packages/directory/src/entity-kind.ts:43` —
  assertEntityExists checks only deleted_at, not status, so every post-merge write path
  (createEdge, linkMatterParty, assignCategory, addIdentifier, addName) attaches new live
  references to a merged-away subordinate through the ordinary API. Failure: a stale tab adds
  a matter party pointing at the archived subordinate — immediately flagged dangling by the
  fitness probe, invisible in search, resolving to the master nowhere. Fix: `AND status !=
'merged_into'` in the guard with a distinct error; regression tests per write path.
- `F-082` **Medium (CONFIRMED)** — correctness — `packages/directory/src/name-history.ts:70` —
  changeName is missing the assertEntityExists guard its sibling addName has: renaming a
  nonexistent entity inserts an orphan current-flagged name row plus phonetic codes into the
  conflicts corpus, no-ops the flip, and returns success with an audit row. Fix: mirror
  addName's guard; test that an unknown id throws and writes nothing.
- `F-083` **Medium (CONFIRMED)** — crypto — `packages/directory/src/identifiers.ts:60` —
  normalizeDriversLicense contradicts its own documented behavior: a licence without a
  "STATE:" separator reaches normalizeUppercaseStrip("") which throws an unmapped
  NormalizeError → opaque 500 on an ordinary clerk input; no test covers drivers_license at
  all. Fix: pick one behavior (enforce the shape at the contract or genuinely tolerate a
  missing state), map NormalizeError to 422, add round-trip tests.
- `F-084` **Medium (CONFIRMED)** — correctness — `packages/directory/src/merge.ts:391` — two
  concurrent merges of the same subordinate into different masters both pass the read-time
  guards; the subordinate-archive UPDATE carries no status guard, so the loser flips
  merged_into_id to master2 while every reference already went to master1 — divergent
  conflicts data plus a phantom entity_merge event. Fix: `AND status = 'active'` on the
  archive UPDATE plus a post-commit verification; longer-term serialize merges per entity
  through the FirmDatabase Durable Object.
- `F-085` **Low (CONFIRMED)** — correctness — `packages/directory/src/edges.ts:68` — createEdge
  accepts from === to, and a self-edge on a future merge subordinate repoints both endpoints
  into a master→master self-loop no code path can create directly and no fitness probe
  detects. Fix: reject identical endpoints; treat other-endpoint-equals-subordinate as a
  self-loop absorb in merge; thread the clock through readEdges.
- `F-086` **Low (CONFIRMED)** — quality — `packages/directory/src/search.ts:107` — searchNames
  returns one hit per matching name row with no per-entity dedup and no LIMIT: current+former
  name matches duplicate rows, and a common-name query against a large corpus buffers an
  unbounded result set in the Worker. Fix: aggregate per entity, add a LIMIT, and batch
  resolveMergedIds into IN-list queries.
- `F-087` **Low (CONFIRMED)** — quality — `packages/directory/CLAUDE.md:42` — the area CLAUDE.md has
  drifted in load-bearing places: the merge invariant claims identifiers/contact rows are
  repointed (the code deliberately leaves them on the subordinate), the key-files list names
  four functions that do not exist, and a frozen-contract comment cites the wrong column name.
  Fix: correct the invariant and names, then decide the real readIdentifier-on-a-master
  behavior.

Refuted: 0.

### custom-fields — needs remediation

The architecture is genuinely good — statement composition into an atomic effect batch, the
shared idempotent-effect seam, append-and-flip history, the exactly-one-value CHECK correctly
paired with the one-current partial unique index, and honestly documented seams. What falls
short is the trust boundary at the value write and the numeric-scaling story: the "typed" EAV
engine never reads the field definition on a value write, and Convert documents apply-time
re-scaling that was never written — a silent 100x error in a dollar amount with no error
anywhere. Tests are real but pointed only at happy paths: none exercise a kind mismatch, a
missing field, or a scale round-trip across Convert.

- `F-088` **High (CONFIRMED)** — financial — `packages/custom-fields/src/convert.ts:169` —
  applyConvert never applies number_scale re-scaling for number/currency conversions despite
  classifyCoercion's comment claiming it happens at apply time. Failure: a number field
  holding 500 converted to currency reads as $5.00 while new writes store $500 as 50000 — the
  field permanently mixes two scales, a silent 100x corruption of monetary values. Fix:
  re-scale by 10^(targetScale − sourceScale) in applyConvert (parking inexact divisions),
  write the post-convert number_scale in the same batch, and pin a round-trip test.
- `F-089` **High (CONFIRMED)** — correctness —
  `packages/custom-fields/src/custom-field-value-service.ts:56` — setCustomFieldValue never
  reads the field definition: a write succeeds for a nonexistent fieldId (orphan row, HTTP
  200 — the route comment claims a service-side read that does not exist) and never checks
  value-kind against field-kind, so a text field accepts an unrounded float into value_number,
  violating the package's own no-floats invariant. Fix: one up-front field read — 404 on
  absent, 422 on kind-family mismatch, always round/validate numeric values.
- `F-090` **Medium (CONFIRMED)** — correctness —
  `packages/custom-fields/src/custom-field-value-service.ts:39` — a picklist optionId is never
  validated (nonexistent, other-field, or archived options all store), and reference values
  get only a prefix check. Failure: a garbage optionId renders blank and Convert's LEFT JOIN
  null-coalesces it to empty string, destroying the value on a text conversion. Fix: verify
  option existence/ownership/liveness and reference-target existence in the same up-front
  read.
- `F-091` **Medium (CONFIRMED)** — correctness — `packages/custom-fields/src/convert.ts:65` —
  previewConvert/applyConvert on a reference-kind field throws a plain Error from toRaw, which
  the route's CustomFieldError-only catch rethrows as a 500 for a foreseeable admin action; a
  reference field with zero values converts "successfully" instead. Fix: a typed
  reference-kind-not-convertible refusal at the top of both, uniform and value-count
  independent.
- `F-092` **Medium (CONFIRMED)** — correctness —
  `packages/custom-fields/src/custom-field-service.ts:80` — every field/option mutation except
  hard-delete skips existence checks: a zero-row UPDATE returns ok:true and commits an
  audit_log row asserting an action that never happened — phantom operations in a legal
  product's audit trail. Fix: pre-read the target row (the hardDelete pattern) and 404 on
  absent.
- `F-093` **Medium (CONFIRMED)** — correctness — `packages/custom-fields/src/convert.ts:160` —
  CONVERT_INLINE_VALUE_LIMIT (500) is enforced nowhere and the converting flag is never set:
  one admin click on a 40,000-value field composes an ~80,000-statement atomic batch, and a
  value written between load and commit is clobbered or survives in the old kind's column.
  Fix: count and refuse above the limit until the queue-driven pass lands; set/clear the
  converting flag in the batch to close the concurrent-write window.
- `F-094` **Medium (CONFIRMED)** — correctness —
  `packages/custom-fields/src/custom-field-service.ts:110` — unarchiveCustomField performs no
  cap check while the caps count only active rows, so archive/define/unarchive cycles push
  active field counts arbitrarily past the anti-bloat ceilings the read fan-out was calibrated
  against. Fix: run assertWithinFieldCaps in unarchive.
- `F-095` **Medium (CONFIRMED)** — correctness — `apps/worker/src/routes/firm/custom-fields.ts:251` — the
  contract is asymmetric on numeric scaling: writes accept a plain decimal and scale it, reads
  return the raw scaled integer while neither value rows nor the resolved-field response
  exposes number_scale (or kind), so a client cannot reconstruct the actual value — 1234
  displayed for $12.34. Fix: expose number_scale + kind, or descale at the route so the API
  speaks decimals both ways; regenerate the contract in the same commit.
- `F-096` **Medium (CONFIRMED)** — correctness — `apps/worker/src/routes/firm/custom-fields.ts:229` — date
  values are never validated: any string stores on a date field, and Convert's prefix regex
  classifies "2025-13-99" and "2025-01-15 lunch with client" as clean dates, breaking every
  downstream sort/range/report over value_date. Fix: full ISO shape + calendar round-trip at
  the route; require the full string to parse in classifyCoercion.
- `F-097` **Low (CONFIRMED)** — correctness — `packages/custom-fields/src/coercion.ts:166` —
  coerceWithRule's magnitude path returns base × multiplier unrounded ("1.2345k" → 1234.5), a
  latent no-floats violation that activates when the confirmed-rule apply path is wired, and
  it never applies currency scaling. Fix: round or refuse non-integral results now, with a
  comment pinning the caller's scaling obligation.
- `F-098` **Low (CONFIRMED)** — quality — `apps/worker/src/routes/firm/custom-fields.ts:178` — unbounded
  contract inputs: numberScale accepts any int (10^300 → Infinity at scaling time → unhandled
  bind failure) and names/text values have no maximum length, so a single value can push
  hundreds of KB into a D1 row. Fix: int().min(0).max(8) on numberScale and sensible max()
  caps on strings.

Refuted: 1 (cap-guards-before-replay idempotency hole — the chokepoint's required-idempotency
gate replays the stored 201 at the HTTP boundary before the handler and its cap guards ever
run).

### fixtures-harness — Fable-grade with reservations

Unusually disciplined for a fixtures package: one seed threads faker, clock, and identifiers;
virtually every row rides a real domain write path; the snapshot cache is content-addressed
with crash-safe artifact-before-manifest ordering; the seeding guard is layered and tested;
the smoke asserts probe label-sets so the gates cannot pass vacuously. The reservation is
that the guarantees thin out at the seams: cache identity trusts migration tags rather than
content, the byte-identical determinism invariant is only tested for the ledger generator,
and the newer domains' EXPLAIN probes guard literal SQL copies rather than the real hot
path — later slices met the letter of the pattern without its verification depth. All
repairable without redesign.

- `F-099` **Medium (CONFIRMED)** — correctness — `packages/fixtures/src/load-profile/snapshot.ts:110`
  — snapshot cache identity hashes migration tags only, not SQL content, so an in-place
  migration edit (a documented precedent in this repo) silently replays a stale-schema
  artifact — the EXPLAIN gates then validate plans against the wrong schema with no error.
  Fix: include a per-migration content hash in the cache identity (the SQL is already read
  from disk).
- `F-100` **Medium (CONFIRMED)** — correctness —
  `packages/fixtures/test/load-profile-generate.test.ts:53` — the seed-twice byte-identical
  determinism invariant is only tested for the ledger generator; practice, directory,
  shipping, protected, and custom-field generators (the large majority of rows) are untested,
  so a domain service later reading Date.now()/randomUUID breaks reproducibility silently.
  Fix: one full-stack determinism test at TINY scale comparing all business tables
  byte-identically, excluding only the documented seams.
- `F-101` **Medium (CONFIRMED)** — reuse —
  `packages/fixtures/src/load-profile/custom-field-measurements.ts:210` — most non-ledger
  EXPLAIN probes are literal SQL copies of the domain queries, so the scan/temp-B-tree gates
  verify the copy, not the real statement — a production hot path can regress to a full scan
  while the stale copy stays green; the ledger module already solved this with
  capturedStatement over exported builders. Fix: export the statement builders from the newer
  domain packages and probe those; delete every literal copy.
- `F-102` **Medium (CONFIRMED)** — quality — `packages/fixtures/src/load-profile/profile.ts:163` —
  profile version 7 shipped with no committed baseline anywhere in git history and nothing
  enforces one, so for that window regressions had no reference point and no test failed.
  Fix: a fitness test asserting the current profile version's baseline file exists, parses,
  and matches the version and measured-set names.
- `F-103` **Low (CONFIRMED, downgraded from medium)** — crypto —
  `packages/fixtures/src/load-profile/directory-generate.ts:99` — one per-firm snapshot mints
  two distinct firm identities (protected-generate and directory-generate each call
  newIdentifier("firm")), so the two sealed surfaces are AAD-bound to different firmIds — any
  future check reading both under one firm context fails AES-GCM verification
  indistinguishably from key corruption. Fix: mint the firm identity once in
  loadProfileSnapshot and thread it through, recording a single manifest-level firmId.
- `F-104` **Low (CONFIRMED)** — reuse —
  `packages/fixtures/src/load-profile/protected-generate.ts:136` — the raw `INSERT INTO
incident` duplicates the identical literal in the incidents route — a raw business-table
  INSERT the package's own CLAUDE.md declares a bug. Fix: extract an insertIncidentStatement
  builder into data-access and use it from both.
- `F-105` **Low (CONFIRMED)** — quality —
  `packages/fixtures/src/load-profile/ledger-measurements.ts:123` — PLAN_SCAN_ALLOWLIST's
  "ledger-fitness" entry is dead configuration (no plan label ever equals it), misleadingly
  implying the fitness scans are probed-and-exempted. Fix: probe them for real or delete the
  entry; keep allowlists exactly equal to probed labels.
- `F-106` **Low (CONFIRMED)** — quality — `packages/fixtures/src/load-profile/profile.ts:98` —
  DirectoryVolume.identifiersPerEntity misnames its semantics (actually "how many persons
  receive one identifier"), so scaling it collapses the blind-index corpus the measurements
  are shaped by. Fix: rename to match behavior (bumping the profile version) or make it a true
  per-entity count.
- `F-107` **Low (CONFIRMED)** — quality — `packages/fixtures/src/load-profile/snapshot.ts:239` —
  LoadedSnapshot.close() never removes the mkdtempSync working directory, so every measure-cli
  run leaks a full-scale snapshot copy into the OS temp directory. Fix: rmSync in close();
  drop the tests' manual tracking.
- `F-108` **Low (CONFIRMED)** — security — `packages/fixtures/src/guard.ts:8` — the
  production-seeding defense's load-bearing half (production code never imports this package)
  has no CI enforcement, and the NODE_ENV check is inert in the environments that matter.
  Fix: a dependency-boundary fitness check failing any apps/ workspace that imports
  @magna-carta/fixtures.

Refuted: 0.

### STATUS.md marker clearance (Phase 1)

Same clearance rule as Phase 0: a slice's Fable-re-review marker clears only if the review
found nothing above low severity in that slice's surface.

| Slice                                    | Marker                                              | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1·1 — Matters + Locations + File Manager | `[x] Opus 4.8 *` (Built)                            | **Stays flagged.** Blocking: the critical default-policy wildcard bug (`upload-policy.ts:29` — Office documents cannot be uploaded) and five highs across the slice's surface — the ingest gate's legacy-Office quarantining (`ingest-core.ts:147`), the post-commit byte-swap window (`ingest-consumer.ts:68`), the presign/read bucket split (`ingest-consumer.ts:70`), the reaped-bundle livelock (`bundle-coordinator.ts:18`), and the matters pair (counter race `matter-service.ts:245`, double-open clobber `matter-statements.ts:80`) — plus the medium tier in all four areas. The locations sub-area alone is medium-max (reservations, not remediation), but it rides the same slice row. |
| 1·2 — `protected()` crypto module        | `[x] Opus 4.8 *` (Built)                            | **Stays flagged.** Covered in Phase 0's encryption area: three confirmed mediums block — the version-blind read path that makes the first firm-key rotation destroy all previously sealed values (`protected-fields.ts:194`), the seal-succeeds/read-fails-forever empty plaintext (`protect.ts:23`), and the crypto-shred cache-convergence gap (`firm-key-provider.ts:51`). The rotation fix is gated before any second key version or second protected field ships.                                                                                                                                                                                                                               |
| 1·3 — Directory                          | `[x] Opus 4.8 *` (Built), `[x] Opus 4.8 *` (Tested) | **Stays flagged (both cells).** Blocking: the three merge-subsystem highs — chained merges surfacing archived entities in the conflicts corpus (`merge.ts:141`), hard-deletion of user content on collision absorption (`merge.ts:331`), and merged-away subordinates accepting new references (`entity-kind.ts:43`) — plus three mediums. The 2026-06-18 Opus adversarial pass fixed one merge generation's defects; the second generation and the concurrent-merge shapes were never exercised.                                                                                                                                                                                                    |
| 1·4 — Custom-fields engine               | `[x] Opus 4.8 *` (Built)                            | **Stays flagged.** Blocking: both highs — the unimplemented Convert re-scaling that silently corrupts monetary values 100x (`convert.ts:169`) and the field-definition-blind value write (`custom-field-value-service.ts:56`) — plus seven mediums concentrated on the same trust boundary.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Load-profile harness (cross-cutting)     | no gap marker                                       | **New logged items, no marker to clear.** The fixtures-harness mediums (tag-only cache identity, single-generator determinism coverage, literal-SQL probes, the missing v7 baseline) enter the remediation backlog; they also qualify the "Load profile `[x] Opus 4.8`" cells on rows 1·1–1·4, whose EXPLAIN-gate assurance is weaker than stated until the literal-copy probes are replaced.                                                                                                                                                                                                                                                                                                        |

## Phase 2 and cross-cutting — Correctness audit

Areas reviewed: scan-engine, editing-collabora, conversion-core, metadata-tool,
integrations-shipping, tools-cores (file-integrity · file-type/Magika · ai-detection),
inference-analytics, pdf-engine, plus an in-flight-branches state survey. Nine area reviews
produced 69 findings; the verification pass spans resumed runs interrupted by credit
exhaustion, so each finding below carries its **latest** verdict (deduped, complete-preferred):
62 CONFIRMED, 3 PLAUSIBLE, 4 REFUTED. Sixteen confirmed highs, no criticals. Almost every
reviewed engine core is genuinely strong; the defects cluster in the wiring and at the byte-
level edges no test was pointed at — and, for the tools that promise "this file is now safe to
send," in the gap between the scrub's coverage and its clean claim.

Note on locations: the working branch (`tools-metadata-scrubber`) is ~735 commits behind main
and predates most of this surface, so reviewers ran against `origin/main` (via the
`main-merge` worktree) or the relevant feature worktree; file:line references are main's unless
a worktree is named.

### scan-engine — strong engine, wiring needs remediation

The Rust core would largely pass the bar: most-dangerous-wins verdict precedence,
never-silent-clean clamd parsing (non-UTF-8/truncated replies → Unavailable), whole-exchange
timeout bounding the INSTREAM write, `catch_unwind` panic isolation, the two-front PDF
stack-overflow guard, and decompression-bomb accounting on _materialized_ (not declared) bytes.
TS/Rust `ScanResult` parity holds; no SSRF/zip-slip/tenancy issue (fixed internal host,
loopback-only clamd, `enableInternet=false`, never extracts to disk). The weaknesses are in the
wiring.

- `F-109` **High (CONFIRMED)** — correctness — `apps/scan-worker/src/index.ts:40` (also
  `apps/worker/src/files/scan-port-binding.ts:13`) — every scan routes to a single container DO
  addressed by the constant name `"scan"`, so `max_instances: 5` is unreachable. Failure: under
  concurrent ingest, multiple full-size scans (600 s clamd budget, 2 GiB body cap) pile on one
  standard-1 instance — OOM risk plus CPU serialization; a scan exceeding the 11-minute adapter
  timeout re-queues, so sustained load backs the queue up indefinitely, contradicting the
  engine's own horizontal-throughput design. Fix: distribute via `getRandom(env.SCAN_CONTAINER,
N)` or sharded ids with a warm-poke per instance, or lower `max_instances` to 1 and document
  single-instance scanning as intent. (Owner decision #3.)
- `F-110` **Medium (CONFIRMED)** — correctness — `containers/scan/src/main.rs:11` — `engineVersion` is
  `clamav+yara-x/{yara_x lib}+heuristics/1`: the `clamav` token is unversioned and the
  signature-DB version is absent, so two scans against materially different signature DBs stamp
  identically and stored "clean" verdicts can't be tied to a signature generation. Fix:
  compose from clamd engine version + ClamAV signature-DB version/date + yara ruleset version.
  (Owner decision #9.)
- `F-111` **Low (CONFIRMED)** — quality — `apps/scan-worker/src/scan-warm.ts:7` — `pokeContainer`
  awaits `container.fetch("/ready")` but ignores the status, so a container answering non-OK
  health checks (clamd DB failed to load, service wedged) is indistinguishable from healthy and
  the warm cron never surfaces it — inconsistent with the sibling `sig-refresh` cron that throws
  on non-ok. Fix: check `response.ok` and throw; apply to both scan-warm copies.

Refuted: 0.

### editing-collabora — needs remediation

The security architecture is strong where designed hardest: the cookieless WOPI surface's
tenancy holds (firm DB and every R2 key derive solely from the HMAC-verified token; MAC checked
before any claim and before expiry), mutating callbacks bound to the live DO `sessionId`,
per-document container isolation structurally present, coolwsd egress-less and credential-less.
No firm-A→firm-B path found. The defects cluster in the working-copy lifecycle and in
check-then-act windows — all silent failure modes that activate the day the container deploys.

- `F-112` **High (CONFIRMED)** — correctness — `apps/worker/src/editing/wopi-routes.ts:96` — `getFile`
  prefers the physical R2 `files/{fileId}/current` object over the token's committed version, so
  a leftover working copy silently shadows a newer version committed via another path. Failure:
  in-app reap cuts v2 (never deleting `current`); an offline checkout fast-forwards to v3;
  Alice's next session serves stale v2 bytes and commits `v2+edits` as v4 — Bob's v3 is silently
  dropped from the lineage. Fix: gate the `current` read on live-session state
  (`deps.currentMeta !== null`), and delete/overwrite `current` after a version cut.
- `F-113` **High (CONFIRMED)** — security — `apps/magna-carta-edit/src/index.ts:37` — the edit worker
  boots a ~2 GB Collabora container for ANY nonempty Host label with zero validation. Failure:
  an unauthenticated loop over `*.magnacartausercontent.com` cold-starts unbounded billed
  containers (cost amplification + concurrent-container exhaustion DoSing legitimate editing);
  and nothing binds a container's label to the document opened inside it. Fix: reject labels
  that are not 52-hex document keys, then require proof (HMAC signed by the app worker at
  launch, or an APP_WORKER verification hop) that the key maps to a live launched session.
- `F-114` **Medium (CONFIRMED)** — correctness — `apps/worker/src/editing/checkout-routes.ts:347` — the
  exclusive-lock single-holder invariant rests on a read-then-insert across two DB round-trips
  with no partial unique index on `document_checkout`. Failure: two concurrent exclusive
  checkouts both read no-lock and both insert; both members believe they hold it. Fix: partial
  unique index `ON document_checkout (file_id) WHERE lock_type='exclusive' AND status='active'`,
  constraint violation → 409.
- `F-115` **Medium (CONFIRMED)** — correctness — `apps/worker/src/editing/wopi-host.ts:55` — all WOPI
  LOCK/PutFile decisions are check-then-act against a worker-side state snapshot mutated in a
  later DO call, and PutFile never compares the presented `X-WOPI-Lock` value. Failure:
  concurrent LOCKs with different values both succeed; a PutFile racing the reap alarm writes
  into an emptied state (orphaned working copy feeding the shadowing bug). Fix: move
  compare-and-set into DocumentSession DO methods atomic under the input gate; validate the lock
  value.
- `F-116` **Medium (CONFIRMED)** — correctness — `apps/worker/src/editing/version-cut-trigger.ts:12` —
  the declared version-cut policy ("on explicit Save and when the last editor leaves") is not
  wired: `shouldCutVersion`'s `save` case has no production caller, PutFile ignores the autosave
  header, and `dropParticipant` is never called from any route — only the 30-minute idle reap
  cuts. Failure: a save-then-offline-checkout works on a pre-edit base and check-in lands as an
  unexplainable conflict. Fix: read Collabora's `X-COOL-WOPI-IsAutosave` in putFile and cut on
  save; wire a session-close route to `dropParticipant`.
- `F-117` **Low (CONFIRMED)** — correctness — `apps/worker/src/editing/document-session.ts:205` — the
  reap alarm's `copyObject` silently no-ops when the `current` source is missing, yet
  `commitEditedVersion` still inserts a version row + meters bytes + audits — a version pointing
  at a nonexistent object. Fix: throw when the source object is null (both copyObject
  callbacks; the reconcile keep='incoming' path shares the swallow).
- `F-118` **Low (CONFIRMED)** — correctness — `apps/worker/src/editing/document-session.ts:134` —
  `dropParticipant` clears `sessionId` on last-editor leave but leaves `wopiLock` set (unlike
  the alarm/forceClose), so once session-close is wired a stuck lock 409s the next session's
  LOCK with no reap to clear it. Fix: clear `wopiLock` in the same save when `sessionClosed`.
- `F-119` **Low (CONFIRMED)** — quality — `apps/magna-carta-edit/src/document-editor-container.ts:36` —
  the comment `(host-topology ADR)` cites a process artifact (golden rule 13) yet evades
  `lint:process-refs` because it lacks the `ADR-NNNN` pattern. Fix: replace with the inline
  reasoning; optionally extend the lint to match bare `\bADR\b`.

Refuted: 0.

### conversion-core — Fable-grade core, needs remediation before integration

The pure core is genuinely good: the `ConversionPort` never-throws discipline holds end to end,
the Dijkstra pathfinder is a correct lowest-total-weight search with the right fitness guards,
and pathfinding is a real seam, not dead generality. No `apps/` consumer imports the package
yet, so every defect is a contained pre-integration fix. The wasm-vips adapter is where hostile
bytes are treated optimistically.

- `F-120` **High (CONFIRMED)** — correctness — `packages/conversion/package.json:6` —
  `"sideEffects": false` contradicts the adapter's registration-by-side-effect pattern
  (top-level `registerEngine` consumed via a bare `import ".../adapters/libvips"`), so a
  production bundler tree-shakes the import and the only implemented engine silently never
  registers — every image conversion returns `engine-not-implemented` in production while every
  Vitest passes (Vitest doesn't shake). Fix: register explicitly at the composition root
  (delete the top-level call), or narrow `sideEffects` to the adapter path.
- `F-121` **Medium (PLAUSIBLE)** — security — `packages/conversion/src/adapters/libvips/index.ts:45` —
  no input-size or pixel-count guard before decoding untrusted bytes: a tiny pixel-bomb PNG
  (declared 60000×60000) drives `writeToBuffer` into a multi-GB decode that blows the Worker
  isolate / browser tab, and the memoized `vipsPromise` then pins the poisoned instance for the
  isolate lifetime. Fix: mirror `packages/metadata/src/guards.ts` — cap byte length and check
  `width*height*bands` against a pixel cap before encode; reset the memo on a fatal WASM error.
- `F-122` **Medium (CONFIRMED)** — correctness — `packages/conversion/src/adapters/libvips/index.ts:45`
  — the Embind image handle is never freed (wasm-vips 0.0.18 requires explicit `.delete()` /
  `Symbol.dispose`; no FinalizationRegistry fallback), so every conversion leaks the decoded
  bitmap in the memoized module's heap — a legitimate batch OOMs mid-run. Fix: `try/finally` →
  `image.delete()` (or `using`); fix the test helper too.
- `F-123` **Medium (CONFIRMED)** — security — `packages/conversion/src/adapters/libvips/index.ts:43` —
  the "hardened path for untrusted bytes" comment is unbacked: no `blockUntrusted(true)` and no
  `operationBlock` allow-list, and `newFromBuffer` auto-sniffs ANY compiled-in loader, so a
  mislabeled `exhibit.png` that is really SVG runs a loader libvips itself marks untrusted. Fix:
  `v.blockUntrusted(true)` + allow-list exactly the five registry raster loaders; optionally
  verify sniffed loader agrees with `input.from`.
- `F-124` **Medium (CONFIRMED)** — correctness — `packages/conversion/src/adapters/libvips/index.ts:45`
  — multi-frame/multi-page sources are silently truncated to frame 1 (`newFromBuffer` defaults
  `n=1`): an animated GIF→WebP or a 40-page TIFF→PNG loses every frame/page after the first with
  `ok:true` — silent evidence truncation. Fix: load `{ n: -1 }` when both ends are multi-frame;
  for lossy pairs (tiff→png) inspect `n-pages` and return a typed failure.
- `F-125` **Low (CONFIRMED)** — quality — `packages/conversion/src/file.ts:89` — `convertFile` copies
  the whole output a second time via `Uint8Array.from(result.bytes)` purely as a `BlobPart`
  typing workaround, doubling peak memory for large outputs. Fix: type the port's success bytes
  as `Uint8Array<ArrayBuffer>` and pass straight to the Blob constructor.

Refuted: 1 (availableConversions/availableTargets advertise deferred-engine conversions — the
code fact is true but the functions have no consumer anywhere outside the package's own tests;
no Convert-to UI/route exists, so the "menu offers guaranteed failures" impact is unreachable
today. Re-open when the UI wires to it — see the deferred-seam inventory).

### metadata-tool — needs remediation (false-clean redaction gaps)

Architecture is genuinely good — clean `MetadataEngine`/`MetadataPort` seams, typed outcomes
that never leak error text, content-based detection, hermetic fixtures, an honest package
CLAUDE.md documenting its deferrals. But for a tool whose promise is "this file is now safe to
send," five highs each produce a false `clean: true`, and the bomb guards don't cover where
inflation actually happens.

- `F-126` **High (CONFIRMED)** — security — `packages/metadata/src/detect.ts:25` — `detect()` fully
  inflates `word/document.xml` with no bomb guard, before `safeUnzip` runs on both inspect and
  scrub paths, so a sub-15 MB high-ratio zip OOMs the isolate before any `BombError` machinery
  fires — the `guards.ts` caps are dead code for this attack. Fix: make the detect filter
  record existence only and never inflate (`return false` from the filter).
- `F-127` **High (CONFIRMED)** — correctness — `packages/metadata/src/ooxml/walk.ts:11` — tracked-
  changes scrub leaves move-range markers (`w:moveFromRangeStart/End`, `w:moveToRangeStart/End`)
  behind — they carry `w:author`/`w:date`, so reviser names and revision dates survive a scrub
  that re-inspects `clean` (inspect's `TRACKED_CHANGE_TAGS` misses them too). Fix: add the
  range-marker + customXml-revision vocabulary to `REMOVE_TAGS` and the inspect set.
- `F-128` **High (CONFIRMED)** — correctness — `packages/metadata/src/ooxml/scrub.ts:80` — whole
  privileged part classes are untouched and unreported: `docProps/thumbnail.*` (a rendered
  page-1 image, including markup just removed from the XML), `customXml/item*.xml` (DMS client/
  matter data), and `word/settings.xml` `w:docVars` / `w:mailMerge` data-source (often a UNC
  path). All ship in the "cleaned" output of one-click SCRUB_ALL with no Finding. Fix: drop
  those parts (plus their `[Content_Types]` overrides and `_rels`) and rewrite `settings.xml`;
  emit findings in inspect.
- `F-129` **High (CONFIRMED)** — security — `packages/metadata/src/image/jpeg.ts:93` — `scrubJpeg`
  copies every byte from SOS onward verbatim — including data appended after EOI — and
  `inspectJpegFindings` never looks past SOS, so a motion-photo MP4 (video + audio) or a JPEG/
  ZIP polyglot survives a scrub reported `clean`. Fix: truncate at the first genuine `FF D9` in
  the entropy stream, or surface an `image-other/high` finding for trailing bytes.
- `F-130` **High (CONFIRMED)** — security — `packages/metadata/src/guards.ts:4` — `MAX_INFLATED_BYTES`
  is 200 MB but a Workers isolate has 128 MiB, so a compliant honestly-declared ~150 MB archive
  passes the pre-inflation check and then OOMs the isolate before the post-inflation backstop
  can fire. Fix: lower the cap to ~48–64 MB (headroom under 128 MiB with input + XML + re-zip
  resident) and record the platform constraint; streaming unzip with a running budget is the
  durable fix.
- `F-131` **Medium (CONFIRMED)** — correctness — `packages/metadata/src/ooxml/scrub.ts:17` — the
  comment-part allow-list misses `word/commentsExtensible.xml` (M365, w16cex), so per-comment
  `dateUtc` timestamps survive a comments scrub. Fix: add it to `COMMENT_PART_PATTERN`,
  `stripCommentRels`, and the inspect check.
- `F-132` **Medium (CONFIRMED)** — correctness — `apps/worker/src/routes/files/metadata.ts:53` — the route
  `atob`-decodes unbounded base64 before any size check, and invalid base64 throws uncaught
  (500 instead of 400) while a ~90 MB body allocates hundreds of MB before `oversize()` runs.
  Fix: `z.string().min(1).max(21_000_000)` with a base64 regex; wrap decode in try/catch → 400.
- `F-133` **Medium (CONFIRMED)** — correctness — `packages/metadata/src/ooxml/scrub.ts:68` —
  `stripCommentRels` removes Relationship nodes by Target filename, not relationship Type, so an
  external hyperlink ending `/comments.xml` is stripped, leaving a dangling `r:id` that makes
  Word flag the doc damaged. Fix: filter on the Relationship `Type` attribute (and/or
  `TargetMode != External`).
- `F-134` **Medium (CONFIRMED)** — correctness — `packages/metadata/src/image/jpeg.ts:25` — when
  `walkSegments` loses sync (fill bytes, wrong length, truncation) it returns `scanStart =
bytes.length`, and `scrubJpeg` emits a header-only image with an appended EOI — silently
  destroying the picture instead of failing `corrupt`. Fix: track whether SOS was reached and
  throw if not; skip spec-legal `0xFF` fill padding.
- `F-135` **Low (CONFIRMED)** — correctness — `packages/metadata/src/ooxml/scrub.ts:85` — dropping
  `docProps/custom.xml` and the comment parts leaves their `[Content_Types]` Overrides and the
  package `_rels` entries dangling → stricter OPC validators (court e-filing) may reject. Fix: a
  `dropPart(name)` helper that removes the part, its content-type override, and its relationship
  together.
- `F-136` **Low (CONFIRMED)** — quality — `packages/metadata/src/metadata.ts:46` — a docx scrub unzips
  three times (detect, scrub, re-inspect), tripling peak memory/CPU on the request hot path.
  Fix: after the detect fix, let scrub return/accept the unzipped entry map so re-inspection
  reuses it.
- `F-137` **Low (CONFIRMED)** — quality — `packages/metadata/src/ooxml/scrub.ts:28` — shorthand
  identifiers (`t`, `acc`, `seg`, `c`) in the redaction-critical walk contradict golden rule 12.
  Fix: rename to `transform`/`accumulator`/`segment`/`chunk`.

Refuted: 0.

### integrations-shipping — needs remediation

The framework core is genuinely good: small typed Dispatch/registry/manifest honoring golden
rules 12/13, a real zod canonical boundary, and an `assertPublicTarget` stronger than most first
attempts (IPv4-embedded IPv6 classification, WHATWG-URL normalization, per-hop redirect
re-guard). Defects concentrate in the shipping worker slice's financial edges and in a
nonfunctional whois IP path — none undermine the architecture.

- `F-138` **High (CONFIRMED)** — financial — `apps/worker/src/routes/communications/shipping.ts:505` — the purchase
  route's double-buy protection rests on an EasyPost `Idempotency-Key` header EasyPost does not
  support (verified against EasyPost docs). Failure: a buy that succeeds remotely but fails
  locally (label fetch / R2 / D1) leaves the effect uncommitted; the retry re-buys, EasyPost
  4xxs `POSTAGE.EXISTS` → 422 forever — the firm paid, the shipment row stays `draft`, no
  disbursement event. Fix: recover-by-read (GET the remote shipment on a replayed key; if
  postage present, treat as success and store), or persist a purchase-pending marker before buy.
- `F-139` **High (CONFIRMED)** — financial — `packages/shipping/src/easypost/map.ts:165` —
  `insuranceAmountMinor` is accepted by the API schema and stored on the draft but never emitted
  to EasyPost, so requested insurance is silently never bought while the row records it as
  purchased — direct malpractice exposure on lost original documents. Fix: send EasyPost's
  `insurance` buy parameter; until wired, 422 requests that set it.
- `F-140` **High (CONFIRMED)** — tenancy — `apps/worker/src/routes/communications/shipping.ts:573` — `GET
/shipments/{id}/label` reads `labels/{id}.pdf` straight from the shared R2 bucket with no
  firm-ownership check, so any member of any firm with `shipping:manage` can stream another
  firm's label (client name + address) by id — the sole R2 route that skips the firm DB. Fix:
  select the shipment from `firm.firmDatabase`, serve only its stored key, prefix keys with firm
  id while the bucket is shared.
- `F-141` **High (CONFIRMED)** — correctness — `packages/whois/src/rdap.ts:136` — the whois IP path is
  essentially nonfunctional: `resolveIpBase` matches CIDR by naive string `startsWith` (missing
  nearly every IANA delegation), the fallthrough throws a raw 500, and IPv6 literals are
  mis-routed; zero IP-path test coverage for a route whose OpenAPI advertises IP lookup. Fix:
  real numeric CIDR containment (longest-prefix) for v4/v6, strip brackets before RDAP routing,
  map no-RDAP to a typed 4xx.
- `F-142` **High (CONFIRMED)** — correctness — `apps/worker/src/routes/communications/shipping.ts:381` — reconnecting
  (API-key rotation) is impossible: connect always INSERTs a new `integration_connection` row,
  but a UNIQUE index on `(category, principal_ref)` makes every connect after the first throw a
  500, and there is no disconnect/update route (`deleteConnectionStatement`/
  `updateConnectionStatusStatement` have zero callers). Failure: a firm rotating a compromised
  key is dead-ended with the old revoked key. Fix: make connect an upsert on conflict; add a
  DELETE route; key the secret deterministically.
- `F-143` **Medium (CONFIRMED)** — financial — `apps/worker/src/routes/communications/shipping.ts:515` — purchase buys
  from EasyPost before verifying the draft exists and never reconciles the supplied
  `remoteShipmentId`/`remoteRateId` with the draft — money spent against a nonexistent/mismatched
  row, or attached to the wrong draft's addresses. Fix: select the draft first (404/409), verify
  the remote id matches the one persisted at rate time.
- `F-144` **Medium (CONFIRMED)** — correctness — `apps/worker/src/routes/communications/shipping.ts:522` —
  `fetch(label.labelUrl)` never checks `response.ok` before storing the body as the permanent
  label PDF, so a transient EasyPost CDN 503 HTML page is stored and served forever as the
  label. Fix: `if (!labelResponse.ok) throw` so the idempotent effect retries.
- `F-145` **Medium (CONFIRMED)** — correctness — `packages/integrations/src/connection.ts:17` — the
  connection-health state machine is dead code (`nextHealth`/`updateConnectionStatusStatement`
  have no production caller), so no dispatch outcome ever updates a connection's status —
  `needs_reauth`/`degraded` are unreachable and the registry's status checks vacuous. Fix: feed
  each non-ok Dispatch category into `nextHealth` + persist; surface `needs_reauth` as a 409.
- `F-146` **Medium (CONFIRMED)** — security — `apps/worker/src/app.ts:309` — production wires no DNS
  resolver into any `assertPublicTarget` call site, so the resolved-IP pass (the documented
  DNS-rebinding defense) is inactive for both whois and safe-browse; only literal-IP checks run.
  Fix: ship the DoH resolver and pass it in — but only to connection destinations. (Owner
  decision #14.)
- `F-147` **Low (CONFIRMED)** — correctness — `packages/whois/src/lookup.ts:28` — once the resolver
  lands, applying it to the whois _query_ will 400 every lapsed/unregistered domain lookup (a
  primary whois use case) with "host did not resolve." Fix: run `assertPublicTarget` without the
  resolver on the query; the resolver belongs on connection destinations.
- `F-148` **Low (CONFIRMED)** — correctness — `packages/whois/src/legacy.ts:41` — a TLD with neither an
  RDAP bootstrap nor a `WHOIS_HOSTS` row throws a raw Error surfaced as a 500 with an internal
  file-path remediation message, instead of a typed unsupported-registry 4xx. Fix: a typed
  `UnsupportedRegistryError` → 422/404; drop the internal instruction from the message.
- `F-149` **Low (CONFIRMED)** — security — `packages/integrations/src/safe-target.ts:95` — `classifyHost`
  misses the trailing-dot loopback form (`localhost.`, `*.localhost.`) — it classifies `public`
  and bypasses the loopback check (impact bounded by platform egress today). Fix: strip one
  trailing dot before classification.
- `F-150` **Low (CONFIRMED)** — quality — `apps/worker/src/app.ts:285` — the production port-43 whois
  socket read loop has no timeout and no size cap, so a wedged/garbage-streaming registry hangs
  the request and buffers unbounded bytes. Fix: race the loop against a ~10 s timeout and cap
  accumulated bytes.
- `F-151` **Low (CONFIRMED)** — quality — `packages/integrations/src/registry.ts:79` — `registry.resolve`
  can throw despite the never-throws Dispatch contract: `adapter.create()` is unguarded and the
  EasyPost adapter throws on a credential-kind mismatch (e.g. an oauth credential on an apiKey
  adapter), 500-ing every shipping route. Fix: verify `credential.kind` before create; wrap in
  try/catch → `adapterError`.

Refuted: 1 (refund idempotent-replay re-hitting EasyPost — the refund route declares
`idempotency:'required'`, so the chokepoint replays the stored 200 before the handler runs; the
claimed failure path does not exist).

### tools-cores (file-integrity · file-type/Magika · ai-detection) — Fable-grade with reservations

Strong work close to the bar: the tools catalog is genuinely pure (permissions asserted at
module load, ids uniqueness-tested); file-integrity is a clean injected-sink single-pass hasher
with a correct no-baseline vs mismatch distinction and a redacted chain-of-custody row; the
file-type report honestly maps Magika sentinels to `unverifiable` and isolates inference panics
as retryable 503s; the ai-detection core has real signal-not-proof enforcement (low reliability
collapses band + segments; consent off by default). All findings are medium/low.

- `F-152` **Medium (CONFIRMED)** — security — `apps/worker/src/routes/files/file-type.ts:100` (and
  `file-integrity.ts:185`) — the per-firm inspectable-size cap is enforced only against the
  client `Content-Length` header, so a missing/malformed header (`Number(undefined ?? "0")=0`,
  `Number("abc")=NaN`) bypasses it entirely — a body far above the cap streams into the hasher
  and, worse, straight into the shared scan container. Fix: count bytes as they arrive
  (counting TransformStream) and 413 over the cap; at minimum reject absent/non-numeric
  Content-Length on these routes.
- `F-153` **Medium (PLAUSIBLE)** — security — `containers/scan/src/lib.rs:206` — `/identify`
  heap-buffers the entire body up to the 2 GiB scan cap via `to_bytes` (unlike `/scan`, which
  spools to disk) on a shared 4 GiB instance holding the ClamAV DB + YARA corpus. Combined with
  the Content-Length bypass, a few concurrent large identify uploads can OOM the container that
  serves `/scan` platform-wide — a cross-tenant availability hit from one firm's user. Magika
  samples only a few KiB, so buffering gains nothing. Fix: route `/identify` through the spool
  path, or give it a far smaller independent body cap.
- `F-154` **Medium (CONFIRMED)** — correctness — `packages/ai-detection/src/normalize.ts:20` — the
  normalizer guards non-finite scores but accepts finite out-of-range scores (>1 or <0) as
  directional verdicts, and a non-finite `vendorConfidence` fails open. Failure: a future vendor
  mapping a 0–100 percentage without /100 makes every document report band `likely`,
  reliability `high` — a confident false "likely AI-generated" on every text checked. Fix:
  clamp out-of-range → `inconclusive` (band + segments), add a fatal caveat, treat non-finite
  confidence as low. (Owner decision #15.)
- `F-155` **Low (CONFIRMED)** — quality — `packages/ai-detection/src/report.ts:50` —
  `DetectionReport.score` sits top-level beside `band`, protected only by a comment, so a UI is
  one property access from rendering "92% AI-generated" as a headline fact. Fix: move the raw
  score into `provenance` (and the same for `SegmentScore`) so `band` is the only top-level
  quantitative claim.
- `F-156` **Low (CONFIRMED)** — quality — `containers/scan/src/identify.rs:45` — `MAGIKA_CRATE_VERSION`
  is a hand-pinned `"1.1"` against a semver-range dependency (`magika = "1.1"` = any 1.x), with
  no test tying the constant to the resolved version — engine-version provenance drifts silently
  on a routine `cargo update`, the same silent-freeze the scan engineVersion was designed to
  avoid. Fix: pin exactly and add a test asserting the resolved version equals the constant.

Refuted: 0.

### inference-analytics — Fable-grade with reservations (shares the Phase-0 telemetry high)

The headline security posture is genuinely solid: the ZDR fail-closed guard holds on every
traced generation path (unknown and non-eligible both refused; catalog schema refuses a non-ZDR
reasoning entry at module load; firm-setting write is schema-restricted and read falls back to a
ZDR default); the HMAC pseudonymizer is fail-closed; consent semantics correct; metering firm
isolation structural (rollup in each firm's own D1). The documented producer-idempotency
carry-forward is a deferred obligation, not re-reported. The one live high is the shared usage
"reached" middleware (see below and Phase 0 telemetry); the rest are seam-shape issues in the
dormant inference pipeline, to fix before the first AI feature's producer lands.

- `F-157` **High (CONFIRMED)** — correctness — `apps/worker/src/usage/reached-middleware.ts:40` — the
  same defect logged under Phase 0 telemetry: the middleware awaits `consent.resolve()` +
  `emitUsage()` unguarded on the outbound pass, so a transient D1 error replaces an
  already-committed 2xx with a 500, violating the documented fail-closed invariant. Fix:
  try/catch the whole post-`next()` block (report, never emit on error), move to `waitUntil`,
  make `emitUsage` never-throw. (Counted once across the two areas; owner decision #8.)
- `F-158` **Medium (CONFIRMED)** — correctness — `packages/inference/src/gateway.ts:218` —
  `generateStream` is written against a binding shape that does not exist: real `env.AI.run(...,
stream:true)` returns a ReadableStream of SSE bytes, so `String(delta)` yields comma-joined
  byte numbers and `extractUsage` on a stream handle returns `{0,0}` — streaming output is
  garbage and streaming runs are never metered; the same gap applies to `generate`'s `{prompt}`
  body for anthropic/\* models. The deferred "composition-root translation" the comments promise
  has no home (`inferencePortFor` passes `env.AI` straight through). Fix: parse the SSE frames
  and add the Anthropic Messages request-body translation before any caller lands; verify
  against the live binding.
- `F-159` **Low (PLAUSIBLE)** — tenancy — `apps/worker/src/inference/inference-consumer.ts:56` —
  `InferenceJob` carries `firmId` and `databaseIdentifier` as two independent unvalidated fields
  (`firmId` cast `as FirmId`, never cross-checked), so a buggy producer could split tenant
  attribution (spend tagged firm A, metering into firm B's DB). Downgraded to low: no producer
  exists yet. Fix: carry only `firmId`, derive `database_identifier` from the control-plane firm
  row (the `member-provision-consumer` pattern), throw on unknown firm.
- `F-160` **Low (CONFIRMED)** — financial — `packages/inference/src/gateway.ts:128` — `extractUsage`
  maps a missing/renamed usage object to `{0,0}` with no signal, so a provider field rename
  would zero firm token metering indefinitely with nothing logged. Fix: bump a telemetry counter
  on absent usage on the generate paths; keep the tolerant-zero return.
- `F-161` **Low (CONFIRMED)** — quality — `apps/worker/src/usage/consent.ts:23` — the consent resolver's
  isolate-local Map never evicts expired entries (only overwritten if the same (firm,user)
  returns), so it grows monotonically per distinct pair. Fix: delete on expired read and/or cap
  the map.

Refuted: 2 (the `settings.ts:19` default-model literal "fleet-wide outage on catalog rename" —
latest verify refuted: the fail-closed path is real but no rotation/removal occurs and the
impact chain did not survive; and `ENVIRONMENT_LABEL` hardcoded `'production'` polluting the env
dimension — no staging/preview deployment exists, so the failure cannot occur).

### pdf-engine — needs remediation (high-quality engine, edge leaks)

Disciplined code: bounded `/Parent` walks with cycle guards everywhere, a decode/encode
round-trip guard before surgery, a verify-after-mutate outcome gate with flatten fallback,
password-redacting Debug, AES-256-only encryption, and tests that probe real failure modes. No
`apps/worker` surface consumes `@magna-carta/pdf` on main today — the wasm runs client-side — so
the memory-bounds findings hit the browser tab now and the Worker isolate once the planned
server-side use lands. The findings are edge cases the tests weren't pointed at.

- `F-162` **High (CONFIRMED)** — security — `crates/pdf-core/src/generate.rs:203` — `split()` leaks
  dropped pages' full content whenever a kept page's annotation references a dropped page:
  `prune_objects` follows the `/Annots → /Dest` (or `/A GoTo`) reference and retains the dropped
  page dict + content streams as orphan objects. Failure: splitting pages 1–2 of a settlement
  where page 2 links to page 9 physically embeds page 9 in the shared file — extractable in any
  PDF inspector. Fix: in `split()`, strip or drop annotations whose resolved destination is
  outside the kept set (the reasoning already applied to catalog keys).
- `F-163` **High (CONFIRMED)** — correctness/confidentiality — `crates/pdf-core/src/redact.rs:353` —
  surgery-mode redaction never touches page `/Annots`, so a markup annotation (FreeText/Text/
  Highlight with `/Contents`) inside the redaction rectangle survives and renders ON TOP of the
  black box (annotations paint above page content); the outcome gate can't catch it because
  `observe_page` walks only the content stream. Flatten mode (the default) is safe — it removes
  `/Annots`. Fix: in the surgery branch, delete annotations whose `/Rect` intersects a redaction
  rect (or force the page to flatten fallback when any non-Link annotation intersects).
- `F-164` **Medium (CONFIRMED)** — security — `crates/pdf-core/src/lib.rs:63` — main today has no
  input-size cap or decompression-bomb guard on any pdf-core entrypoint (load, redact, sanitize,
  detect, merge/split/rotate, forms, `scan_logical_content`) — all inflate untrusted FlateDecode
  unboundedly; a kilobyte deflate bomb aborts the wasm instance today and would kill a 128 MB
  isolate once server-side. The complete fix already exists, unmerged, on branch
  `pdf-decompression-guard`. Fix: merge that branch (confirm it also bounds
  `scan_logical_content`'s per-stream `decompressed_content()`). **Highest-leverage single
  action for this area.**
- `F-165` **Medium (CONFIRMED)** — security — `crates/pdf-core/src/watermark.rs:246` — `image_xobject`
  fully decodes the watermark via `image::load_from_memory` BEFORE the `MAX_IMAGE_PIXELS` check,
  so the cap doesn't bound the decode it claims to; a few-hundred-KB 20000×20000 PNG attempts a
  ~1.6 GB decode. Fix: read dimensions cheaply first and reject; lower the cap to logo scale.
- `F-166` **Medium (CONFIRMED)** — correctness — `crates/pdf-core/src/redact.rs:150` — flatten-mode
  redaction has no cap on rendered raster size (page dims × dpi/72), so a legitimate large-format
  exhibit (5000×5000 pt at 300 dpi ≈ 20833² raster) turns redaction into a multi-GB allocation
  that aborts instead of failing typed — and may push the user to retry in the weaker surgery
  mode. Fix: compute pixels from page size, downscale dpi above a budget or return
  `PageTooLarge`.
- `F-167` **Medium (CONFIRMED)** — correctness — `crates/pdf-core/src/generate.rs:231` — merge (and
  split/rotate/watermark/bates) silently emits corrupt output for a password-protected input:
  lopdf leaves streams encrypted when the empty user password fails, and merge builds a fresh
  trailer dropping `/Encrypt` — undecryptable ciphertext with no error. Fix: check
  `doc.trailer.has(b"Encrypt")` at the top of each entrypoint and return a typed
  `Encrypted` error directing the caller through `decryptDocument` first.
- `F-168` **Low (CONFIRMED)** — correctness — `crates/pdf-core/src/generate.rs:487` — merge renames
  colliding named destinations / field `/T` but never remaps their referrers (outline items,
  link annotations with string `/Dest` or GoTo `/D`, field-referencing JS), so doc B's internal
  links resolve to doc A's destination. Fix: record old→new per input and rewrite string
  `/Dest`/`/A GoTo /D` in that input's annotations/outlines.
- `F-169` **Low (CONFIRMED)** — correctness — `crates/pdf-core/src/generate.rs:106` —
  `reparent_self_contained` flattens inherited `/MediaBox`/`/Resources`/`/Rotate` but not
  `/CropBox` (also inheritable), so a page inheriting CropBox from an ancestor loses it in
  split/merge output (scanner borders reappear). Fix: add a bounded `resolve_cropbox` and set it
  when distinct from MediaBox.
- `F-170` **Low (CONFIRMED)** — correctness — `crates/pdf-core/src/watermark.rs:404` — `append_content`
  (and the identical bates stamp-append) doesn't wrap the original content in `q/Q` (an unbalanced
  source CTM skews the overlay) and its `_ =>` fallback replaces a direct `/Contents` stream with
  only the overlay, discarding the page's content. Fix: prepend `q\n` / insert `Q\n`, promote an
  inline Stream to indirect in the fallback, and extract the shared append helper (golden rule
  1).

Refuted: 0.

### in-flight branches — state survey

Not a per-defect area — a maturity + drift survey of the four active feature worktrees, read at
their absolute paths (all branch homes exist as stated). Three findings against the streams are
logged; the dominant risk across the area is coordination, not craftsmanship.

- **decryption-tool** (worktree `C:/dev/magna-carta-worktrees/decryption-tool`, ~50 ahead, **421
  behind main**): the largest, most sensitive stream. Slice 1 (server-side strip/inspect) + Slice
  2 Plan 1 (recovery engine + container) are built, TDD-reviewed, and cross-validated against
  real hashcat example*hashes. The worker route is genuinely careful about the no-secret-leak
  keystone (password never logged, audit digest is of the encrypted input, generic wrong-password
  errors); `recover.rs` clamps every shard and cannot panic. Two real concerns: it branched
  pre-engine-host (merge-base `413b43b`) and is 421 commits behind — a very large merge, and it
  was built \_parallel to* `crates/engine-host` rather than on it (the SP3 retrofit is still
  owed); and it introduces `containers/recovery` + `apps/recovery-worker` that collide with
  file-repair-salvage's planned names. Slice 2 Plan 2 (DO coordinator + Queue fan-out) is **not
  built** — the note's own NEXT. Not mergeable as-is: needs a main sync, ADR fragments, STATUS/
  ROADMAP/changelog/user docs, and the name reconciliation.
- **file-repair-salvage** (HEAD `e0b9a50`, ~21 ahead, 62 behind): `crates/recovery-core` built
  cleanly ON the engine-host harness with honest loss manifests, per-entry/total/count caps, and
  OOXML OPC reconstruction. Zip and CFB pillars progressing (CFB is a skeleton). One real bomb
  gap (below). The heavy-lane container is still unbuilt — good, because its planned path
  collides with decryption-tool.
- **pdf-decompression-guard** (~13 ahead, 50 behind): the tightest, nearest-mergeable stream.
  `guard.rs` is a well-reasoned parser-agnostic pre-flight (input cap + bounded zlib/raw inflate
  via a discarding CountingSink + cumulative ceiling) wired into every public entrypoint with
  good adversarial tests; no DoS found in the scan loop. LZW/RLE residual explicitly disclosed.
  Merging it is the single highest-leverage action for the pdf-engine findings. Just needs a main
  sync + completion-time doc updates.
- **ai-detection-pangram** (~1 ahead, 16 behind): design-only — a single commit with a spec +
  active-work note; no adapter/route/migration yet (`packages/ai-detection/src/adapters/` holds
  only `deferred.ts`). Barely started; nothing to review beyond the plan. (The core `ai-detection`
  package findings are logged under tools-cores.)

Findings:

- `F-171` **Medium (CONFIRMED)** — security — `crates/recovery-core/src/zip_repair.rs:89`
  (file-repair-salvage) — the over-cap "drain to realign" step re-inflates the very deflate bomb
  the per-entry cap just refused: after reading `MAX_ENTRY_UNCOMPRESSED_BYTES+1` (512 MiB) it
  calls `io::copy(&mut file, &mut sink())` on the decompressing `ZipFile` reader, decompressing
  the remaining ~9.5 GB into the sink; the total ceiling only sums _recovered_ entries, so up to
  100k such entries can each be drained — a CPU-exhaustion DoS with flat memory. Fix: seek the
  underlying cursor by the stored compressed size, or `.take()`-bound the drain and abort the
  scan (returning what was recovered) on the first over-cap entry.
- `F-172` **Medium (CONFIRMED)** — quality — `docs/active-work/file-repair-salvage.md:18` — two branches
  independently claim `containers/recovery` and overlapping "recovery" naming
  (`crates/recovery-core` for file repair next to decryption-tool's `crates/decryption-core` +
  `apps/recovery-worker` + `containers/recovery` for password recovery), guaranteeing a merge
  path collision and eroding name clarity (golden rule 12). No guard reserves the path; `vp run
worktrees` is advisory. Fix: reconcile now in the active-work notes — give the file-repair
  container a domain-specific path (e.g. `containers/file-repair`) and reserve `containers/
recovery` + `apps/recovery-worker` for decryption (or rename decryption's artifacts
  `password-recovery`). (Owner decision — see roadmap in-flight streams.)
- `F-173` **Low (CONFIRMED)** — correctness — `apps/worker/src/routes/files/decryption.ts:373`
  (decryption-tool) — a failed unlock (wrong password / unreadable) returns 400 without writing
  any audit row, so unsuccessful decryption attempts leave no chain-of-custody trace while the
  success path is fully audited — an asymmetry a legal chain-of-custody tool should not have.
  Fix: emit a redacted `decryption.unlock_failed` / `inspect_failed` audit row (outcome=failed +
  error code, never the password or content) in the error branches.

Refuted: 0.

### STATUS.md marker clearance (Phase 2 + cross-cutting)

Same clearance rule: a slice's `*`/`↻` marker clears only if the review found nothing above low
severity in that slice's surface. (Rows read from `origin/main`'s STATUS.md; the working
branch's copy is stale.)

| Slice / row                                                                             | Marker                                                | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2·1 — Inbound upload path + untrusted-file pipeline + async bulk download               | `[x] Opus 4.8` (Built), Fable re-review pending       | **Stays flagged.** Blocking: the scan container-instance high (`scan-worker/src/index.ts:40` — `max_instances` unreachable, OOM/queue-backup risk) plus the engineVersion medium and the scan-warm health-check low. The Rust engine itself is Fable-grade; the block is wiring. Note the worker-files-surface highs from Phase 1 (byte-swap, presign/read split, bundle livelock) also ride this pipeline.                                                                                                                 |
| 2·2 — Editing + versioning & storage tiering                                            | `[x] Opus 4.8` (Built)                                | **Stays flagged.** Blocking: two highs — the stale-`current` document-regression path (`wopi-routes.ts:96`) and the unauthenticated container-spawn / label-binding gap on the edit worker (`magna-carta-edit/src/index.ts:37`) — plus three correctness mediums (exclusive-lock unique index, WOPI check-then-act, unwired version-cut policy). All activate the day the coolwsd container carries real traffic.                                                                                                           |
| 2·3 — Inline preview + safe-delivery sandbox                                            | `[x] Opus 4.8 *` (Built), `[x] Opus 4.8 *` (Tested)   | **Clears to Fable-confirmable — no wave-3 findings in the 2·3 surface.** The safe-delivery edge was not in scope of a dedicated wave-3 area and the editing review found no defect on the preview path. Recommend a targeted Fable pass over `apps/worker/src/editing/wopi-*` and the files-preview edge before dropping the `*`, since it shares the editing worker; provisionally clearable.                                                                                                                              |
| 2·4 — In-app conversion                                                                 | `[~] Sonnet 4.6` (Built, in progress)                 | **Stays flagged.** Blocking (pre-integration): the `sideEffects:false` tree-shake high that silently drops the only implemented engine in production, plus the wasm-vips security/correctness mediums (pixel-bomb guard, Embind leak, blockUntrusted allow-list, multi-frame truncation). None require redesign; fix as the execution substrate (2·1/2·2) wiring lands.                                                                                                                                                     |
| PDF render engine (cross-cutting)                                                       | `[x] Opus 4.8` (Built)                                | **Stays flagged.** Blocking: the two confidentiality highs — `split()` embedding dropped pages via annotation refs (`generate.rs:203`) and surgery-mode redaction leaving annotations over the black box (`redact.rs:353`) — plus the decompression-guard gap (fix exists on `pdf-decompression-guard`, merge it) and the memory-bounds/encrypted-input mediums. Not yet wired to any route, so browser-only today.                                                                                                         |
| Metadata Inspector & Scrubber                                                           | `[x] Sonnet 4.6` (Built), `[x] Sonnet 4.6 ↻` (Tested) | **Stays flagged (both cells).** Blocking: five highs, each producing a false `clean:true` for a "safe to send" tool — detect-path bomb bypass, surviving move-range reviser metadata, untouched privileged part classes (thumbnail/customXml/docVars/mail-merge), JPEG after-EOI payload survival, and the 200 MB > 128 MiB inflation cap — plus four correctness mediums. Highest-priority tools-area remediation.                                                                                                         |
| File Hash & Integrity                                                                   | `[x] Sonnet 4.6` (Built), `[x] Sonnet 4.6 ↻` (Tested) | **Stays flagged (both cells).** The core is Fable-grade; the block is the shared route-level Content-Length cap bypass (`file-integrity.ts:185`) — a body above the firm cap streams into the five-way hasher. Clears once the counting-stream cap lands (shared fix with File Type Verifier).                                                                                                                                                                                                                              |
| File Type Verifier                                                                      | `[x] Sonnet 4.6` (Built), `[x] Sonnet 4.6 ↻` (Tested) | **Stays flagged (both cells).** The report mapper is honest; the block is the Content-Length cap bypass (`file-type.ts:100`) feeding the shared scan container, the `/identify` heap-buffer availability medium, and the `MAGIKA_CRATE_VERSION` provenance-drift low. Clears with the shared cap fix + the spool/cap change on `/identify`.                                                                                                                                                                                 |
| AI-Text Detection                                                                       | `[x] Opus 4.8` (Built)                                | **Stays flagged.** Blocking (before the vendor adapter + UI land): the out-of-range-score normalizer medium (false confident "likely AI") and the top-level raw-score placement low. Cheap now, contract-and-UI-wide later. (Owner decision #15.)                                                                                                                                                                                                                                                                           |
| AI inference foundation                                                                 | `[x] Opus 4.8` (Built)                                | **Stays flagged.** Blocking: the shared reached-middleware high (also Phase 0 telemetry) and the `generateStream`/request-body binding-shape medium — both must be fixed before the first AI feature's producer goes live. The ZDR/consent/metering-isolation core is Fable-grade.                                                                                                                                                                                                                                          |
| Usage analytics                                                                         | `[~] Opus 4.8` (Built, core)                          | **Stays flagged.** Blocking: the reached-middleware high on the production request path plus the consent-cache no-evict low; the pseudonymizer/consent/suppression design is sound.                                                                                                                                                                                                                                                                                                                                         |
| Integration port system · Shipping · Property links · Integration platform · Tools area | `[x] Opus 4.8` (Built)                                | **Shipping stays flagged** (four financial/tenancy highs before it carries real postage spend + the whois/framework mediums/lows). The **framework, property-links, integration-platform, and tools-catalog** rows are **medium-max (reservations)** — the pure link builders and the manifest/registry core found no high — but they ride shared rows with shipping and the SSRF-resolver-wiring medium, so treat the cross-cutting integrations surface as flagged until the shipping highs and the resolver wiring land. |

## Development roadmap (Artifact B)

The build direction that follows from Artifact A: what to fix, in what order; where the
in-flight streams go next; the seams the review surfaced as deliberately deferred; and the
highest-leverage growth directions. Fixes are logged work items — this sequences them, it does
not apply them.

### 1. Remediation backlog

Every confirmed **critical/high** across all three report sections, in one table, ordered
severity-then-phase. Suggested sequencing: **S1** = fix-first sprint (owner decision #6:
critical + data-integrity + tenancy + financial, before new features); **S2** = before the
consuming slice/feature goes live (dormant pipelines, pre-integration engines); **S3** =
opportunistic (fix as the area is next touched). Mediums are summarized per area below the
table.

| #   | Sev          | Finding                                                                                 | Area (phase)                      | File:line                                                     | Fix direction                                                                        | Seq    |
| --- | ------------ | --------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| 1   | **Critical** | Default upload policy refuses all Office/ODF docs (wildcard not honored)                | file-manager (P1)                 | `packages/file-manager/src/upload-policy.ts:29`               | Honor trailing `.*`; gate tests vs real docx/xlsx/pptx/odt/doc/msg/pdf               | **S1** |
| 2   | High         | Ingest gate quarantines every legacy .doc/.xls/.ppt/.msg + benign variants              | file-manager (P1)                 | `packages/file-manager/src/ingest-core.ts:147`                | Sniffed/declared equivalence table; accept CFB container types                       | **S1** |
| 3   | High         | Post-commit byte-swap window past the scanner (stale hash served clean)                 | worker-files (P1)                 | `apps/worker/src/files/ingest-consumer.ts:68`                 | Store etag at commit; treat overwrite event as re-ingest/quarantine; shorten PUT TTL | **S1** |
| 4   | High         | Presign/read bucket split — every upload for a REST-provisioned firm dead-letters       | worker-files (P1)                 | `apps/worker/src/files/ingest-consumer.ts:70`                 | One bucket source of truth (presign against bound bucket); integration test          | **S1** |
| 5   | High         | Reaped-bundle rebuild livelock (ready-forever DO)                                       | worker-files (P1)                 | `apps/worker/src/downloads/bundle-coordinator.ts:18`          | Force-rebuild on observed-missing artifact; DO test                                  | **S2** |
| 6   | High         | Matter-number counter race (non-scoping variable segment)                               | matters (P1)                      | `packages/matters/src/matter-service.ts:245`                  | `matter_number_allocation` UNIQUE(scope_key,counter_value) in the draw batch         | **S1** |
| 7   | High         | Concurrent double-open overwrites the frozen matter number                              | matters (P1)                      | `packages/matters/src/matter-statements.ts:80`                | `AND status='prospective'` guard + allocation UNIQUE(matter_id)                      | **S1** |
| 8   | High         | Chained merges surface archived entities in the conflicts corpus                        | directory (P1)                    | `packages/directory/src/merge.ts:141`                         | Repoint node `merged_into_id` (collapse chains); add to fitness probes               | **S1** |
| 9   | High         | Collision absorption hard-deletes user content (soft-delete invariant)                  | directory (P1)                    | `packages/directory/src/merge.ts:331`                         | Soft-delete-and-repoint for deleted_at tables                                        | **S1** |
| 10  | High         | Merged-away subordinate still accepts new references                                    | directory (P1)                    | `packages/directory/src/entity-kind.ts:43`                    | `AND status != 'merged_into'` in the existence guard                                 | **S1** |
| 11  | High         | Convert never re-scales number↔currency → silent 100x corruption                        | custom-fields (P1)                | `packages/custom-fields/src/convert.ts:169`                   | Re-scale 10^(Δscale), write new number_scale in-batch, round-trip test               | **S1** |
| 12  | High         | Value write never reads the field definition (orphan rows, kind mismatch)               | custom-fields (P1)                | `packages/custom-fields/src/custom-field-value-service.ts:56` | One up-front field read — 404 absent, 422 kind mismatch, round numerics              | **S1** |
| 13  | High         | Usage "reached" middleware turns analytics failure into a 500                           | telemetry + inference (P0/wave 3) | `apps/worker/src/usage/reached-middleware.ts:40`              | try/catch post-`next()`, move to `waitUntil`, `emitUsage` never-throws               | **S1** |
| 14  | High         | Scan routes to a single container instance (`max_instances` unreachable)                | scan-engine (wave 3)              | `apps/scan-worker/src/index.ts:40`                            | `getRandom`/sharded ids + per-instance warm-poke (owner #3)                          | **S1** |
| 15  | High         | Edit `getFile` serves stale `current` → silent document regression                      | editing (wave 3)                  | `apps/worker/src/editing/wopi-routes.ts:96`                   | Gate `current` read on live-session state; delete after cut                          | **S2** |
| 16  | High         | Edit worker boots a 2 GB container for any Host label (unauth DoS)                      | editing (wave 3)                  | `apps/magna-carta-edit/src/index.ts:37`                       | Validate 52-hex key + HMAC/registration proof of a live session                      | **S2** |
| 17  | High         | `sideEffects:false` tree-shakes the only implemented conversion engine                  | conversion (wave 3)               | `packages/conversion/package.json:6`                          | Explicit registration at composition root (or narrow sideEffects)                    | **S2** |
| 18  | High         | detect() inflates document.xml with no bomb guard (isolate OOM)                         | metadata (wave 3)                 | `packages/metadata/src/detect.ts:25`                          | Header-only detect filter (never inflate)                                            | **S1** |
| 19  | High         | Move-range reviser name/date survive tracked-changes scrub (false clean)                | metadata (wave 3)                 | `packages/metadata/src/ooxml/walk.ts:11`                      | Add range-marker vocabulary to REMOVE_TAGS + inspect set                             | **S1** |
| 20  | High         | Privileged part classes untouched + unreported (thumbnail/customXml/docVars/mail-merge) | metadata (wave 3)                 | `packages/metadata/src/ooxml/scrub.ts:80`                     | Drop parts + overrides + rels; emit findings                                         | **S1** |
| 21  | High         | JPEG after-EOI payload (motion-photo video/audio, polyglot) survives scrub              | metadata (wave 3)                 | `packages/metadata/src/image/jpeg.ts:93`                      | Truncate at genuine EOI, or surface a finding                                        | **S1** |
| 22  | High         | Inflation cap 200 MB > 128 MiB isolate → OOM on compliant archive                       | metadata (wave 3)                 | `packages/metadata/src/guards.ts:4`                           | Lower cap to ~48–64 MB; streaming unzip the durable fix                              | **S1** |
| 23  | High         | EasyPost `Idempotency-Key` unsupported → paid-but-failed purchase, retries 422 forever  | shipping (wave 3)                 | `apps/worker/src/routes/communications/shipping.ts:505`       | Recover-by-read on replayed key / purchase-pending marker                            | **S1** |
| 24  | High         | Requested insurance silently never bought (record misrepresents)                        | shipping (wave 3)                 | `packages/shipping/src/easypost/map.ts:165`                   | Send EasyPost `insurance` buy param; 422 until wired                                 | **S1** |
| 25  | High         | Label GET reads shared bucket by path id — cross-firm label leak                        | shipping (wave 3)                 | `apps/worker/src/routes/communications/shipping.ts:573`       | Serve from firm-verified row's stored key; firm-prefix keys                          | **S1** |
| 26  | High         | Whois IP path nonfunctional (string-prefix CIDR, raw 500)                               | shipping/whois (wave 3)           | `packages/whois/src/rdap.ts:136`                              | Numeric CIDR containment v4/v6; strip brackets; typed 4xx                            | **S3** |
| 27  | High         | API-key rotation impossible (connect always INSERTs into a UNIQUE index)                | shipping (wave 3)                 | `apps/worker/src/routes/communications/shipping.ts:381`       | Upsert on conflict; add DELETE route; deterministic secret key                       | **S2** |
| 28  | High         | PDF `split()` embeds dropped pages via kept-page annotation refs                        | pdf-engine (wave 3)               | `crates/pdf-core/src/generate.rs:203`                         | Strip/drop annotations whose dest is outside the kept set                            | **S2** |
| 29  | High         | Surgery-mode redaction leaves annotations painting over the black box                   | pdf-engine (wave 3)               | `crates/pdf-core/src/redact.rs:353`                           | Delete rect-intersecting annotations, or force flatten fallback                      | **S2** |

Also carried at high from Phase 1 (already in the Phase 1 section, not re-tabled): none beyond
the above — the Phase 0/1 highs are rows 1–13.

**Mediums, summarized per area** (full detail in each area section):

- **money (P0):** allocate() distribution contract + input validation; currency exponent-2
  assumption (owner #7).
- **database / data-access (P0):** fleet-rollout has no production caller; control-plane
  lineage has no application path; expand-contract per-file (not per-statement) waiver; outbox
  `aggregate_key` index (hot-path scan) + outbox retention with purge-safe seq.
- **ledger (P0):** reversal effective-date can precede the original.
- **encryption (P0):** version-blind read path (rotation destroys sealed values), empty-plaintext
  seal-succeeds/read-fails, crypto-shred cache convergence (owner #12).
- **access-control / chokepoint (P0):** public-surface enforcement not tied to the guard;
  fail-open direct-grant expiry; comment-skipping seed-permission fitness; chokepoint composition
  fitness proves the wrong proxy.
- **telemetry (P0):** object-value allowlist bypass; unguarded `count()` path; separated-digit
  scrub miss; console-ban scan roots (fixed by the scan-worker extraction).
- **matters / locations / file-manager (P1):** close-without-precondition; close-precondition
  seam not in-batch; renumber audit metadata; predictable constraint violations → 500; location
  status unread; half-built firm-default location; R2 orphan deletion; zip-slip in bundle
  composition; soft-delete-blind mutations.
- **directory / custom-fields (P1):** changeName missing guard; drivers-license normalize throw;
  concurrent-merge archive race; picklist/reference/date value validation; phantom-audit on
  zero-row updates; unarchive cap check; asymmetric numeric-scaling contract; Convert
  reference-kind 500; inline-value-limit unenforced.
- **fixtures-harness (P1):** tag-only cache identity; single-generator determinism; literal-SQL
  EXPLAIN probes; missing v7 baseline.
- **scan-engine (wave 3):** engineVersion composition (owner #9).
- **editing (wave 3):** exclusive-lock unique index; WOPI check-then-act; unwired version-cut
  policy.
- **conversion (wave 3):** pixel-bomb guard; Embind handle leak; blockUntrusted allow-list;
  multi-frame truncation.
- **metadata (wave 3):** commentsExtensible part; unbounded base64 route decode; Target-based
  rels filter; JPEG desync truncation.
- **tools-cores (wave 3):** Content-Length cap bypass (file-type + file-integrity); `/identify`
  heap-buffer; ai-detection out-of-range score (owner #15).
- **inference-analytics (wave 3):** generateStream/request-body binding shape.
- **shipping / integrations (wave 3):** purchase-before-verify-draft; label fetch no `ok` check;
  dead connection-health machine; SSRF resolver not wired (owner #14).
- **pdf-engine (wave 3):** decompression guard (merge `pdf-decompression-guard`); watermark
  decode-before-cap; flatten raster no cap; encrypted-input silent corruption.
- **in-flight (wave 3):** zip_repair over-cap drain re-inflates the bomb; recovery-naming
  collision.

### 2. In-flight streams — next steps

- **decryption-tool** — (1) Sync `main` now (421 commits behind is the dominant risk; every day
  widens it). (2) Reconcile the `containers/recovery` / `recovery-worker` naming with
  file-repair-salvage _before_ building further (owner call — recommended: file-repair takes
  `containers/file-repair`, decryption keeps `containers/recovery`). (3) Build Slice 2 Plan 2 (DO
  coordinator + Queue fan-out) — the note's NEXT. (4) Retrofit onto `crates/engine-host` (the SP3
  obligation). (5) Add the failed-unlock audit row (wave-3 low). (6) Land ADR fragments + STATUS/
  ROADMAP/changelog/user docs before merge. Add a firm-configurable per-file/per-actor unlock
  attempt ceiling (growth).
- **file-repair-salvage** — (1) Fix the `zip_repair.rs:89` over-cap drain (seek by stored
  compressed size, or `.take()`-bound and abort) before the CFB pillar lands. (2) Take a
  domain-specific container path (`containers/file-repair`) per the naming reconciliation. (3)
  Finish the CFB pillar (skeleton today). (4) Keep the heavy-lane container unbuilt until the
  path collision is resolved.
- **pdf-decompression-guard** — nearest-mergeable. (1) Confirm the guard also bounds
  `scan_logical_content`'s per-stream `decompressed_content()`. (2) Sync `main`. (3) Merge — it
  closes remediation row for pdf-engine medium (`lib.rs:63`) and is the single highest-leverage
  pdf action. (4) Do completion-time doc updates.
- **ai-detection-pangram** — design-only. Before building the adapter: apply the two ai-detection
  core fixes (out-of-range clamp, raw score under provenance — owner #15) so the vendor adapter
  and UI are built against the corrected contract. Then build the Pangram adapter + route +
  migration + consent UI on the vendor-agnostic core.
- **scan-worker extraction** — finish the service-binding switchover in `apps/worker` (currently
  half-done, uncommitted). Switch container addressing to `getRandom`/sharded ids (remediation
  row 14) with a warm-poke per instance. The extraction also brings `apps/scan-worker/src` under
  the telemetry console-ban fitness (Phase 0 medium). Commit + document.
- **metadata scrubber (current branch `tools-metadata-scrubber`)** — this branch is a stale
  pre-merge snapshot (~735 behind main; OOXML-inspect only). Per the worktree-lifecycle rule,
  **clean it up** — the shipped tool is on `main`. The five metadata highs + four mediems apply
  to `main`'s copy; schedule them there (remediation rows 18–22), not on this branch.
- **trust 3·2** — not built; brainstorming/research with a complete requirements substrate. Next:
  (1) owner commits the corpus (decision #1). (2) Finish the N/A-label cleanup pass named in the
  handover (misclassified-N/A bugs first, then the 44 weak-label relabels, then the
  unclaimedFunds decision alongside the data model). (3) Resume the DESIGN (brainstorm →
  writing-plans → build): the jurisdiction-profile engine reading `profiles.json`-shaped data,
  the per-field rigor/restriction/data resolution, the two new gates (cleared/good-funds on
  deposits, disputed-funds freeze), the matter-close zero-balance gate (first consumer of the
  1·1 close-precondition hook — which the matters review flagged must become in-batch, medium),
  and the monthly three-way reconciliation + signed archive. v1 scope = engine + ABA baseline +
  Nevada overlay.

### 3. Deferred-seam inventory (surfaced by the review)

Seams the code deliberately built-but-did-not-wire; the review confirmed each is dormant, not
broken. Track so none is mistaken for finished:

- **Fleet migration rollout** (`fleet-rollout.ts`) and **control-plane lineage application** —
  no production trigger; safe only while the fleet is one firm.
- **Outbox retention/purge** — no purge design; must be built with purge-safe seq allocation.
- **Encryption key rotation** — version-blind read path; gate before any second key version /
  BYOK (owner #12).
- **Integration connection-health machine + connect/disconnect/rotate routes** — built, zero
  callers; wire with the connection-management UI.
- **DNS resolver for `assertPublicTarget`** — the rebinding defense is inactive in production
  until the DoH resolver is wired (owner #14).
- **Conversion execution substrate** — LibreOffice/FFmpeg/email engine bodies return
  `engine-not-implemented`; `availableConversions` reachability advertises them (refuted as a
  bug only because no UI consumes it yet — re-open when the Convert-to UI wires in).
- **file-manager scan cache** (`lookupScanCache`) — write-only; wire into hash-first lanes.
- **Weekly re-scan sweep** — enqueues messages the ingest consumer no-ops on until a real engine
  - committed-version verdict-update path exists.
- **Metadata matter-action auto-scrub** — the port + safe-delivery pipeline exist; the
  outbound-seam auto-scrub (discovery production / portal send) is the flagged high-value next
  step.
- **AI inference producer idempotency key** — the consumer is at-least-once; the first AI
  feature's producer must add a stable key + dedup guard.
- **Usage-analytics beacon (D) + Iceberg tier (F)** — client traffic + Cloudflare-infra steps;
  wire `suppressSmallCells` as the structural chokepoint when the Iceberg read path lands.
- **Editing:** WOPI token refresh (>60 min sessions), PutRelativeFile (Save As), session-close →
  `dropParticipant` wiring (also a correctness medium), container prewarm at launch.
- **Shipping:** EasyPost tracker webhooks, `validateAddress` route, cost-recovery outbox consumer
  (shipment.purchased → matter disbursement — the Phase-3 seam).
- **Engine-host SP3 retrofit** — decryption-tool + sibling engines onto `crates/engine-host`.
- **Container fan-out primitive** (the deferred ADR the decryption handover names) — both
  decryption recovery and file-repair heavy-lane will address a container fleet by instance id;
  consolidate before the second one lands.

### 4. Growth directions — top 10 highest-leverage

Drawn from the wave growth ideas (full list in `docs/research/growth-backlog.md`); each with a
one-line why-now.

1. **Metadata matter-action auto-scrub at the outbound seams** — the v1 tool only protects users
   who remember it; the port + safe-delivery pipeline already exist, so a scrub-on-send firm
   policy converts an ethereal utility into a firm-wide malpractice guardrail. **Why now:** the
   seams are built and the metadata highs are being fixed anyway.
2. **Shared bytes-in/result-out bounded-decompress primitive** (pdf-core guard, recovery-core,
   metadata guards, decryption-core) — three in-flight crates each re-implement bomb bounding
   with subtly different semantics; one audited primitive would have caught the zip_repair drain
   gap. **Why now:** consolidate before more format families and the 421-commit-drift streams
   diverge further.
3. **Per-firm AI spend surface** — join `token_usage_meter` with per-model pricing added to the
   curated catalog to render a daily cost view + hang per-firm spend caps. **Why now:** the
   metering rollup is already day/slot/model bucketed; pricing makes cost a pure read, and firms
   are cost-wary of AI.
4. **Signature-refresh re-scan reconciliation** — once engineVersion encodes the signature-DB
   version (owner #9), a bounded background sweep re-scans files whose verdict predates a
   signature update. **Why now:** malware becomes detectable only after signatures catch up; a
   custodian pipeline shouldn't trust a point-in-time "clean" forever.
5. **Conversion provenance record** — have `executePath` return the executed chain (per-hop
   engine id/version, recipeRef, input/output digests). **Why now:** a converted document may be
   filed or produced; provable derivation is evidentiary value the scan/hash tools already
   established.
6. **Bulk hash verification against an opposing-party load file** — accept a CSV/DAT of hashes,
   compare against stored ingest baselines matter-wide, one receipt. **Why now:** MD5/SHA-1 are
   already retained for eDiscovery interop and the per-file compare/receipt/audit primitives
   exist — this is the production-exchange workflow firms actually perform.
7. **Live editing-session visibility + one-click forceClose for firm admins** — the DocumentSession
   DO already holds participants/lock/last-save per document. **Why now:** a small read surface
   over existing state; exactly what practice managers ask for when a document appears stuck, and
   it gives the lock-admin story a home.
8. **EasyPost tracker webhooks + `validateAddress` at intake** — replace poll-and-cache tracking
   with pushed `tracker.updated`, and expose the already-implemented address validation at
   client/opposing-counsel intake. **Why now:** proactive service-of-process proof and fewer
   failed service attempts, both nearly free (adapter, schema, errors already exist).
9. **Platform-generic container fan-out primitive** (the deferred ADR) — both decryption recovery
   and file-repair heavy-lane will build near-identical DO-coordinator + Queue + service-binding
   fan-out. **Why now:** define it before the second stream copies the first across 400+ commits
   of drift.
10. **Metadata polyglot/trailing-data detector shared with the scan engine** — the JPEG-after-EOI,
    PNG-after-IEND, and zip-anomaly signals the scrubber needs are the same raw facts the 2·1
    scan raw-facts model wants. **Why now:** one byte-level parser serves scrubbing _and_
    malware/exfiltration detection instead of two divergent ones — and the metadata after-EOI fix
    (row 21) is being built now.

### 5. Accepted execution sequencing (owner, 2026-07-02)

Constraints set by the owner: remaining Fable usage goes to **UI development** (a separate Fable
stream); this session lacks the context to run backend and UI in parallel. All backend fixes and
in-flight branch work **defer to Opus** sessions as usage allows. Every logged fix WILL be
implemented — this section fixes the order, not the intent.

**Balancing rule — fix in the path you're about to walk.** Apply a logged fix when a session is
already about to build on the code it lives in (the build-when-in-the-area principle). Do not run
one monolithic fix sprint, and do not do pure feature work that steps over a known defect in the
same file. Everything else batches by activation gate below, not by calendar date.

**Opus session order when usage returns:**

1. **Quick-win pair — fold into whichever session opens first.** Upload-policy critical (decision
   4: a legal product must accept a `.docx`) + telemetry reached-middleware high (decision 8:
   analytics failure turns a committed 2xx into a 500). Both small, both corrode every demo and
   every other stream's testing, neither belongs to one feature.
2. **decryption-tool rebase (most perishable).** One session purely syncing the branch onto `main`
   (421 commits behind + the `containers/recovery` naming collision). No new feature work on the
   branch until it is synced — merge cost compounds weekly.
3. **pdf-decompression-guard merge.** Nearest-mergeable branch and itself a logged remediation;
   landing it retires a stream and shrinks drift for free.
4. **ai-detection.** Apply decision 15 (clamp out-of-range scores, band-only top-level claim, raw
   score under `provenance`) BEFORE the Pangram adapter — cheap now, contract-breaking once an
   adapter + UI depend on the shape. Then continue the branch.
5. **Files-correctness sprint (one session — shared test surface).** Matters numbering allocation
   table (decision 2) + presign/read bucket source-of-truth (decision 10) + post-commit byte-swap
   window (decision 11).

**Activation gates — the fix becomes mandatory at the named event; defer freely until then**
(no production users today, so most highs are not yet burning):

- Any real firm uploads a file → decisions 4, 10, 11.
- Live postage spend enabled → decision 13 (EasyPost idempotency, insurance, cross-firm label read).
- Convert runs on real data → decision 5 (custom-fields re-scaling + definition-blind write).
- A second firm-key version or second `protected()` field → decision 12 (rotation read path).
- Trust 3·2 consumes `allocate()` → decision 7 (largest-remainder in-house).
- First Container fan-out copy-paste → growth item 9 (generic fan-out primitive).

**Stream-isolation rule (while the UI Fable stream runs in parallel):** the UI stream treats the
backend as **read-only**. Anything it trips over is filed as a new item appended to this report,
never fixed inline. Backend remediation is exclusively Opus-session work under this sequencing, so
the two streams never contend on the same files.

`ROADMAP.md` gains its remediation entry when the first fix session actually opens (same-commit
discipline); until then this section is the authoritative sequencing record.

### Accepted remediation sequencing (owner, 2026-07-02)

Constraint set: remaining Fable usage goes to UI development; all backend fixes and branch work
defer to Opus sessions as usage allows. All logged fixes WILL be implemented. Balancing rule:
**fix in the path you're about to walk** — apply a logged fix when work is about to build on the
code it lives in, and batch the rest by activation gate, not by date.

**Opus session order when usage returns:**

1. **Quick-win pair (fold into whichever session comes first):** the upload-policy critical
   (decision 4 — a legal product must accept .docx) and the telemetry reached-middleware high
   (decision 8 — analytics failure converts a committed 2xx into a 500). Both small, both
   corrosive to every demo and every other stream's testing.
2. **Decryption-tool rebase (most perishable):** one session purely rebasing the branch onto
   `main` (421 commits behind + the naming collision). No new feature work on the branch until
   it is synced — merge cost compounds weekly.
3. **pdf-decompression-guard merge:** nearest-mergeable in-flight branch and itself a logged
   remediation. Landing it retires a stream and shrinks drift for free.
4. **ai-detection:** decision 15 (clamp out-of-range scores; band-only top-level; raw score under
   provenance) BEFORE the Pangram vendor adapter lands — cheap now, contract-breaking later.
   Then continue the branch.
5. **Files-correctness sprint (one session, shared test surface):** matters numbering allocation
   table (decision 2), presign/read bucket source-of-truth (decision 10), post-commit byte-swap
   window (decision 11).

**Activation gates (fix becomes mandatory at the named event, defer freely until then):**

- Before any real firm uploads files → decisions 4, 10, 11.
- Before live postage spend → decision 13 (EasyPost idempotency, insurance, cross-firm label read).
- Before Convert runs on real data → decision 5 (custom-fields re-scaling + definition-blind write).
- Before a second firm-key version or a second `protected()` field → decision 12 (rotation read path).
- Before trust 3·2 consumes `allocate()` → decision 7 (largest-remainder in-house).
- Before the first Container fan-out copy-paste → growth item 9 (generic fan-out primitive).

**Stream-isolation rule:** the UI Fable stream treats the backend as read-only — anything it
trips over is filed as a new report item (append to this file), never fixed inline. Backend
remediation is exclusively Opus-session work under this sequencing.

`ROADMAP.md` gains its remediation entry when the first fix session actually opens (same-commit
discipline); until then this section is the authoritative sequencing record.
