---
slug: scan-raw-facts
status: Accepted
area: Untrusted-file pipeline / Malware scanning
date: 2026-06-25
summary: The malware-scan Container reports raw engine facts (a RawScanResult — clamd state, structural heuristic, YARA matches each tagged {tier, score, isSuspicious}, per-leg timings) instead of deciding a verdict. The full YARA corpus is baked and scanned once; the per-firm file verdict (clean | flagged | unscanned) is computed app-side by computeVerdict from a firm scan policy, so a firm can re-tier its policy with no container re-scan and cross-firm content dedup stays global. The content-dedup scan_cache stores the raw result keyed on the engineVersion of that same result; a clean ingest commit repopulates it. The four prior verdicts collapse to one scan-flagged state. clamd-unavailable is a raw fact (HTTP 200), raised to a retryable fault app-side; the only container 503 is an in-process engine panic.
---

**Scan engine reports raw facts; the per-firm verdict is computed in the application.**

**Context:** the scan Container previously combined clamd + yara-x + structural heuristics into a single
fixed verdict (`clean | infected | unscanned | suspicious`) with a hard-coded precedence and a single
fixed YARA tier. That bakes one policy into the engine: a firm cannot choose how aggressively to flag,
and re-tiering would mean re-scanning. The content-dedup cache stored the pre-decided verdict, so the
same bytes could not be re-evaluated under a different policy without a fresh scan.

**Decision:** the Container reports **raw facts** as a `RawScanResult` — clamd state
(`clean | infected{signature} | unavailable`), the structural heuristic
(`none | structural{reason} | encrypted | active-content`), the YARA matches (each carrying
`{ruleId, tier, score, isSuspicious}`), the engine version, and per-leg timings. The **full** YARA
Forge corpus is baked and every rule scanned **once**; the engine decides nothing. The application's
`computeVerdict(raw, policy)` (`packages/file-manager/src/verdict.ts`) turns those facts plus a firm
scan policy (tier ceiling + suspicious-score floor) into a `clean | flagged | unscanned` file verdict,
reproducing the previous default behaviour at the default policy. Because the decision is app-side over
cached facts, a firm can re-tier with **no container re-scan**, and the content-dedup `scan_cache`
stays global across firms (the same bytes scanned once serve every firm's policy). The cache stores the
raw result and is keyed on the `engineVersion` **of that same raw result** — the one honest source —
so a clean ingest commit repopulates it and the access-triggered re-scan path reuses it. The four prior
quarantine verdicts collapse to one `scan-flagged` state (the reason — signature, rule id, or heuristic
— is recorded). A deployed engine going dark returns `clam: unavailable` with **HTTP 200**, raised to a
retryable `ScanFaultError` in the application (never a fabricated clean); the **only** container 503 is
an in-process engine panic.

**Scope:** this is **Slice A** — the engine substrate (the tagging build, concurrent engines + timing,
the enriched raw contract, and the cache reshape) plus the worker/ingest wiring to consume it. The
firm-facing pieces — firm-scoped scan-policy settings, the flagged-file treatment menu (block /
informed-access ± step-up re-auth / allow-and-flag) applied uniformly at ingest and access, and the
settings UI — are **Slice B**, built on this substrate.

**Consequences:** the Rust `combine`/`CombineOutcome` verdict layer is removed; the boundary type is
`RawScanResult` on both sides (byte-matched Rust↔TS, zod-revalidated at the worker). The seam to per-firm
gating is now a pure app-side recomputation over the cache — no re-scan — which is the whole point of
baking the full corpus and tagging every match.
