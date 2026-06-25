# Access-Triggered Re-Scan & Content Dedup — Design

**Status:** Design (approved decisions) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**Builds on:** the slice 2·1 scan engine + the per-firm content-dedup cache (`scan_cache`, migration `0016`; data layer `packages/file-manager/src/scan-cache.ts`). **Context:** [`2026-06-22-scan-throughput-decision-and-horizontal-plan.md`](2026-06-22-scan-throughput-decision-and-horizontal-plan.md).

---

## Problem

Malware scanning is a point-in-time judgment against the signature database **at scan time**. New signatures ship constantly, so a file that scanned clean can later be malicious without changing a byte (a zero-day caught later; a legacy corpus scanned before the engine existed; a DB improvement). Re-scanning closes that gap. Two pieces are missing:

1. **No in-place re-scan path.** The ingest consumer only processes `pending` versions and no-ops on already-committed ones (`loadPendingVersionForIngest` filters `status='pending'`). The weekly `runRescanSweep` enqueues committed-unscanned versions, but every such message currently dies at the consumer's no-op — its own comment says the processing "arrives with the real scan engine." This feature is that deferred half.
2. **The dedup cache has no reader.** `lookupScanCache` exists with zero callers; the skip needs to consult it before scanning.

**Cost reality (measured):** scanning is cheap — ~$0.0024/GiB ≈ **~$2.50/TiB** on a continuously-busy `standard-2` instance (Cloudflare Containers: memory $0.0000025/GiB-s, CPU $0.00002/vCPU-s, disk $0.00000007/GB-s; clamd's ~15 MiB/s floor). A full 5 TB firm scans for **under $10**. So the design optimizes **not for compute cost** but for (a) aligning scans with risk, (b) no standing infrastructure, and (c) **no data loss**.

## Decisions (approved with the owner)

1. **Trigger — file-level, access-triggered.** Re-scan a _file_ when it is opened / previewed / downloaded, never a proactive corpus sweep and never a whole-matter pre-warm. A file nobody opens is never re-scanned (it can't harm anyone until accessed). Matter size is irrelevant to cost; only files actually opened cost anything. _(The existing weekly `runRescanSweep` proactive sweep is removed/disabled — it only scans dormant files no one is looking at.)_
2. **Staleness gate.** A file is re-scanned on access only if its stored `scan_engine_version` differs from the **current** engine version. Same engine ⇒ no re-scan (instant). So a file is only ever _scanned_ the first time it is accessed under a new engine version; every duplicate and repeat access is a cache hit.
3. **Cache-first, cache both verdicts.** Consult `lookupScanCache(content_sha256, currentEngineVersion)` before scanning. A hit applies the verdict with no clamd call; a miss scans then records. **Both `clean` and `infected`** are cached (the `engine_version` in the key makes a DB update a deliberate miss, so there is no stale-infected risk within an engine version).
4. **Informed access — NO data loss.** A re-scan that finds a committed, user-visible version **infected** leaves it in place: same current-version pointer, still listed, `scan_verdict='infected'`. No quarantine-hide, no version-regress, no file going dark. Instead:
   - The **safe preview** renders the file's content through the conversion/preview pipeline (no raw bytes to the user's machine) — so "view" is always available and never touches the payload.
   - A **raw download** of a flagged file requires an explicit confirmation **+ re-authentication** ("This file was flagged as containing `<signature>`. Open anyway?").
   - Every access of a flagged file is **audit-logged** (chain-of-custody / liability record).
   - A **notification** fires to the matter's users when a file they've touched is flagged.
5. **Current engine version — a per-firm setting.** `fileManager.scanEngineVersion` (a `setting` row), set by the engine-rollout/deploy process, read synchronously like the other scoped settings — no container round-trip on the hot path. **Null guard:** if unset, the re-scan path falls through to an actual scan (never fabricate a cache key), exactly as the commit path refuses to cache when `scanEngineVersion` is null.
6. **Fast-follows (out of scope for the first slice):** the safe-preview rendition (leans on the conversion engine) and an optional user-initiated **"scan this matter now"** button (user-paced, user-justified).

## Flow

**On file open / preview / download** (the access trigger, in the files route handler):

```
read current engine version (setting)              ── null ⇒ enqueue scan, serve safe-preview meanwhile
is the version's scan_engine_version == current?
  ├─ yes  → serve per its verdict (gate if infected)         (instant; common case)
  └─ no (stale / unscanned) →
        lookupScanCache(content_sha256, current)
          ├─ clean hit    → in-place verdict update (async), serve
          ├─ infected hit → in-place verdict update, serve safe-preview + gate raw download + notify
          └─ miss         → serve safe-preview now under last-known status; enqueue a background
                            re-scan (read R2 → scanPort → write verdict in place → recordScanCache);
                            if it returns infected, notify + future opens gate
```

Opening is **never blocked** on a scan: a cache hit is instant; a true miss serves the safe-preview immediately and scans in the background.

## Components

1. **Engine-version setting** — `fileManager.scanEngineVersion` + a typed resolver; the rollout/deploy step writes it. (Also: stamp it on each commit/scan so it is observable.)
2. **Access-trigger check** in the file open/preview/download handler — the staleness + cache-first + enqueue-on-miss + serve-with-gate logic above.
3. **In-place re-scan consumer path** — process a committed `clean`+stale version: cache-first, else R2 read + `scanPort.scan`, then write the verdict in place + `recordScanCacheStatement`. Distinguished from the pending path by **status** (load by `r2_key` without the pending filter; branch `pending` vs `clean`-unscanned-or-stale).
4. **In-place verdict-update statement** — a NEW statement gated `WHERE id=? AND status='clean'` that stamps `scan_verdict` / `scan_engine_version` / `scan_detail` **without** moving the current-version pointer (commit/quarantine refuse non-pending rows and must not be reused). Idempotency key `rescan:<versionId>:<engineVersion>` (the same version is legitimately re-scannable under a new engine).
5. **Informed-access download gate** — a confirmation + re-auth step on the raw download of an `infected` version; the existing audited `/download` path records it.
6. **Notification** on a fresh `infected` finding.
7. **Read-mediation change** — listing shows a committed version regardless of verdict; the **download** path keys the gate on `scan_verdict='infected'`. (Today download requires `status='clean'`; under informed access an infected-but-committed version is downloadable behind the gate.)
8. **Remove the proactive weekly sweep** (`runRescanSweep`) — superseded by access-triggered.

### Fast-follows

- **Safe preview** of an infected file via the conversion/preview rendition.
- **On-demand "scan this matter now"** button (user-initiated bulk pass over a matter, routed to the bulk lane).

## State machine & read mediation (the central correctness piece)

A committed (visible) `file_version` may now hold `scan_verdict ∈ {unscanned, clean, infected}`. This is new: today `infected` never reaches a committed row (`CommitVersionRow.scanVerdict` only permits `unscanned|clean`; infected only ever occurs on a pending version that never gained visibility). The change is deliberate and **additive**:

- `status` stays the lifecycle/visibility axis (`pending → clean → …`); the **safety** lives in `scan_verdict`.
- Listing/visibility is unchanged (a committed version lists).
- The **download** mediation changes: `clean`/`unscanned` → serve; `infected` → serve only behind the confirm + re-auth gate, audited.
- The in-place update statement is narrowly gated so it never races the pending-commit path (which only touches `pending` rows).

## Cost model (for sizing, not a constraint)

With dedup + the engine-version gate, the unit of cost is **unique content actually opened, once per engine version**. A busy firm touching ~20 GB of distinct files/day with daily DB updates lands around **$1–5/month**; dormant archives, however large, are **$0**. Even the worst single case — first open of a 20k-file matter after a DB update, _matter-level_ — is ~$0.025; _file-level_ (this design) is a fraction of a cent because only the files actually opened are scanned. (Caveat: many-tiny-files pay fixed per-scan overhead, so effective throughput drops; still tens of dollars at corpus scale, not thousands.)

## Risks & open items

- **Serving known-malware (security posture).** Informed access deliberately keeps flagged files reachable (gated, re-auth'd, audited) because they are the firm's own legal records where losing access can be worse than a controlled, consented risk — and the safe-preview path means _viewing_ never touches the payload. This is a deliberate deviation from hard-quarantine DLP; record it in `security.md` as an accepted, mitigated posture.
- **Race window.** A cache-miss file opens under its last-known status before the background scan finishes; the gate applies on the _next_ open + a notification fires. For high-stakes types, optionally scan-before-serve (block briefly) — a tuning knob.
- **Engine-version setting ownership.** The deploy/engine-rollout process must write `fileManager.scanEngineVersion` on every engine upgrade; a stale/unset setting is safe (falls through to scan), just less efficient.

## Testing

Clean-hit-skips-clamd · miss-scans-and-records · redelivery-idempotent (same engine) · re-scan-under-new-engine runs again · null-setting falls through to scan · infected-in-place keeps the version visible + gates the raw download + audits + notifies · the safe-preview path renders without the payload.

## Rough task shape (for the plan)

1. `fileManager.scanEngineVersion` setting + resolver + the null-guard; stamp it on commit/scan.
2. Extend the committed-version read to carry `content_sha256`; add a non-pending-gated loader by `r2_key`.
3. In-place verdict-update statement (status='clean'-gated, no pointer move) + audit/outbox event.
4. Consumer dispatch: status-branch pending vs clean-stale; the re-scan path (cache-first → scan → write → record).
5. Access-trigger in the open/preview/download handler (staleness + cache-first + enqueue-on-miss).
6. Informed-access download gate (confirm + re-auth) + read-mediation change + notification.
7. Remove the proactive weekly sweep.
8. Tests per the list above.
9. Fast-follows: safe-preview rendition; on-demand matter scan.
