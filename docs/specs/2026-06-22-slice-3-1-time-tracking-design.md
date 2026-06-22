# Slice 3·1 — Time tracking + WIP + rate engine — design

**Status:** Accepted (design) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**White-paper home:** _Financial Core — Time tracking_ (§17.1) · _Settings → Scope & resolution_ (the precedence chain rate resolution mirrors)
**Phase-opening map:** [`2026-06-21-phase-3-financial-core-slice-map.md`](2026-06-21-phase-3-financial-core-slice-map.md) (the slice's scope, gates, seams, and the phase-wide invariants this slice honours)
**Competitive input:** [`../research/2026-06-22-competitive-time-tracking-deep-dive.md`](../research/2026-06-22-competitive-time-tracking-deep-dive.md)
**ADRs (this slice, carried as `docs/decisions/pending/` fragments, numbered at merge):** time-entry lifecycle + the **optional review gate** (revises white-paper §17.1's "no approval workflow"); the **per-timekeeper live-timer Durable Object** (the codebase's first DO); the **effective-dated rate engine** (rate cards + per-entry override + retroactive-correction policy). Builds on ADR-0061 (integer-minor money, no floats), ADR-0062 (type-prefixed handles), ADR-0071 (package / data-access seam), ADR-0067 (the ordered chokepoint), ADR-0072 (append-only ledger — the WIP→A/R target it leaves untouched), ADR-0078/0083 (build-when-in-the-area + load-profile accretion), ADR-0003 (per-firm tenancy), ADR-0017/0038 (observability), ADR-0109 (client consent — the AI gate, still Proposed).

This is the implementation-grade design for slice 3·1: the **daily driver** — keyboard-first time capture, the work-in-progress store, and the effective-dated rate engine. **Backend + API only**; the UI plan rides 0·7a/0·7b like 1·1/1·3. It does not restate the phase-wide invariants fixed in the slice map (WIP-is-not-a-ledger-posting, append-only, effective-dating, the idempotency theme) — it realises them for time.

**Build gates (all on `main`):** the append-only ledger (0·3 — the WIP→A/R target, left untouched here), Matters + Locations (1·1 — matter/timekeeper/location attach points, the `setting` + `audit_log` seams), `protected()` (1·2 — not needed by time data), the `@magna-carta/money` primitives (`Rate` e4, `multiplyByQuantity`, `rounding`, `allocate`), the `InferencePort` foundation, and the load-profile harness.

**Prerequisite for:** 3·4 Billing (consumes the WIP fee entries + effective-dated rates this slice produces, and the UTBMS catalog this slice owns); 3·3 Costs (consumes the shared UTBMS expense-code catalog this slice lands).

---

## 0. Decisions resolved (this brainstorm, 2026-06-22)

1. **AI is seamed now, shipped fast-follow.** Build the manual+timer+WIP+rate core plus the real `InferencePort` call-site and the producer's stable idempotency-key structure (the two consumer guards that close re-meter + re-bill complete with the feature, §9), but gate the narrative/UTBMS-suggestion feature itself behind **ADR-0109** (consent) being Accepted. The differentiator is **AI UTBMS-code suggestion** — narratives are now market parity (§9).
2. **Optional review gate, built now, default OFF.** The lifecycle is **Draft → (Submitted → Approved) → Billed**, with the Submitted/Approved states gated by a firm setting `approval_required` (default off, preserving the frictionless white-paper default). The submit/approve/kick-back transitions and a reviewer permission are built in this slice. This **will revise white-paper §17.1's "no approval workflow"** line on ADR acceptance (§6, §13).
3. **Per-timekeeper live-timer Durable Object** — the codebase's first DO; idle-friendly so cost is negligible (§4).
4. **Scratch/unbound timer** — a timer may run with no matter yet; **binding to a matter is required only at commit** (§4).
5. **Offline (Tauri) sessions sync as Draft entries**, never a live-timer takeover (§4).
6. **Idle/abandoned-timer detection** via a DO alarm → **keep / trim-to-last-activity / discard** (§4).
7. **Rounding direction (up/nearest/down) is a configurable setting**, resolved through a **scoped-setting resolver this slice builds** — the first realization of the white-paper settings-precedence chain, per-timekeeper included; net-new infrastructure, not reuse of the flat `setting` seam (§2.6, §5).
8. **Retroactive rate corrections:** a rate change is a **new effective-dated version**; **billed entries never change**; **Draft entries keep the rate captured on their date**, with an opt-in **re-rate-unbilled-drafts** action (§3.3).
9. **Non-billable categories are firm-configurable** (seed-and-fork, defaults-not-locks) (§2.4).
10. **My Day missing-time = target shortfall + un-logged-day detection** from time data now; the **calendar overlay and calendar-derived one-click capture are seams** that light up with the Phase 6 Calendar (§7, §8).

---

## 1. Package & boundaries

A new domain package **`@magna-carta/timekeeping`** (full name; "timekeeper" is the legal term, matching the `member`-as-timekeeper axis), on the established domain-package pattern (pure services returning `EffectWrite`, no ambient clock/identity/RNG — injected `ClockPort` + `actorUserId` + `randomSource`, mirroring `packages/data-access/src/shipment-service.ts` and `packages/matters/src/matter-service.ts`). It holds three cohesive concerns with clean internal boundaries:

- **time-entry** — the WIP store + the Draft→Billed lifecycle + the capture-commit path.
- **rate engine** — effective-dated rate cards + resolution. _Extraction seam:_ 3·4 Billing also resolves rates; if a second consumer needs it, the rate engine lifts to `@magna-carta/rates` (the promote-on-second-consumer rule). For now it lives here behind a `resolveRate(context)` interface so the lift is mechanical.
- **utbms** — the UTBMS task/activity/expense code catalog (**3·1 owns it**; 3·3/3·4 consume it).

The **live-timer Durable Object** is Worker-level infrastructure (`apps/worker`), **not** business data — see §4 on the tenancy boundary. The package never imports the DO; the DO never holds business rows.

Reuse, do not rebuild: `@magna-carta/money` for all rate×quantity arithmetic (`Rate`, `multiplyByQuantity`, `rounding`, `allocate` — no floats, no new money machinery); the flat `setting` seam (`packages/data-access/src/setting-statements.ts`) for firm-level knobs; `@magna-carta/identifiers` for handles; the `audit_log` seam for every change; the data-access effect-batch chokepoint (`composeEffectBatch`/`runIdempotentEffect`) for every write. **The one genuinely net-new piece of shared infrastructure 3·1 lands is the scoped-setting resolver (§2.6)** — the flat `setting` seam cannot do the per-entity/per-timekeeper precedence the rate and rounding knobs need.

---

## 2. Data model (new per-firm tables)

Net-new tables on `packages/database/src/per-firm-schema.ts` (no expand-contract). Conventions: TEXT identifier-handle primary keys (ADR-0062), CHECK-enforced enums, amounts as `amount_minor`, rates as `_e4` integers, soft-archive not hard delete, every FK to `matter`/`member`/`location` reusing the existing targets. A new per-firm migration (next slot after `0014_inference-token-usage` — coordinate the number via `vp run worktrees` against the parallel 3·2/3·5 streams).

### 2.1 `time_entry` — the WIP store
The single live row per captured unit of time. Only **committed** entries live here; an in-flight scratch timer lives in the DO (§4), not this table.

| Column | Notes |
|---|---|
| `id` | `timeEntry_` handle (PK + public id) |
| `matter_id` | FK → `matter`. **NOT NULL** (binding is required at commit; the scratch state never reaches this table) |
| `timekeeper_user_id` | FK → `member`/user — who the time is for (not necessarily the actor) |
| `work_date` | civil `PlainDate` in the timekeeper's zone (white paper line 291) — the **effective date** reports read |
| `duration_minutes` | INTEGER **quantity** in minutes (not a time-of-day). The rounded, billable quantity |
| `raw_duration_minutes` | INTEGER — the captured (pre-rounding) minutes, kept for audit/realization |
| `narrative` | TEXT — the work description |
| `billable` | INTEGER bool |
| `non_billable_category_id` | FK → `non_billable_category`, nullable (set only when `billable = 0`) |
| `currency` | TEXT ISO-4217, **NOT NULL**, CHECK against the registered set, seed `USD` — carried so a `@magna-carta/money` `Rate`/`Money` is reconstructable and a future multi-currency entry is a row-value change, not a migration (slice-map invariant #11) |
| `rate_e4` | INTEGER — the **resolved rate snapshot** (the rate in force on `work_date`), frozen on the entry. **NULLABLE:** null for non-billable internal time (no client rate); for flat-fee/contingency matters the standard rate is still captured (for realization), not null |
| `rate_card_id` | which card resolved the rate (null when `rate_e4` is null) |
| `rate_source` | CHECK in (`override`,`matter`,`client`,`timekeeper`,`role`,`card_default`) — which precedence tier resolved the rate; a **superset of `rate.tier`** (`override` and `card_default` are resolution outcomes, not stored `rate` rows). Audit/explainability; null when `rate_e4` is null |
| `amount_minor` | INTEGER — `round(rate × hours)` via `@magna-carta/money`, computed at capture, recomputed only on an explicit re-rate (§3.3). **NULLABLE**, tied to `rate_e4` by CHECK (`amount_minor` null ⟺ `rate_e4` null) |
| `utbms_task_code_id` / `utbms_activity_code_id` | FK → `utbms_code`, nullable (required only when the matter's `e_billing` flag is on — §11) |
| `status` | CHECK in (`draft`,`submitted`,`approved`,`billed`,`void`) |
| `source` | CHECK in (`timer`,`manual`,`quick_add`,`grid`,`offline_sync`,`calendar`*) — provenance (*`calendar` is the Phase-6 seam) |
| `invoice_id` | nullable FK, set at billing (3·4) — null until billed |
| standard audit columns | `created_at`/`updated_at`/`created_by`; the who/when of every change also lands in `audit_log` |

**Indexes** (covering the measured reads, §10): `(timekeeper_user_id, work_date)` for My Day / weekly grid; `(matter_id, status)` for per-matter unbilled WIP (the 3·4 billing read); `(status, work_date)` for the approval queue.

**Lifecycle is a column-level freeze contract, not the ledger's append-only rule.** The service is the only writer and validates each transition (§6); `status` is a normal mutable column whose legal transitions are UPDATEs. On entering `billed` or `void` the row's business columns **freeze** — the service refuses any UPDATE to a `billed`/`void` row except the 3·4 `invoice_id`/lock set that accompanies the bill. Pre-terminal transitions (draft↔submitted↔approved) and the §3.3 re-rate of a draft are legal UPDATEs. Corrections to a billed entry are **new adjusting entries**, never edits. The §14 fitness check is concrete: no statement updates a `time_entry WHERE status IN ('billed','void')` (beyond the billing lock) — distinct from, and weaker than, the ledger's never-mutate invariant.

### 2.2 `rate_card` + `rate` — effective-dated rates
- `rate_card` — `id` (`rateCard_`), `name` (e.g. "Standard", "Insurance-capped"), `archived_at`. Multiple named cards per firm.
- `rate` — `id` (`rate_`), `rate_card_id`, **scope tier** (CHECK in `matter`,`client`,`timekeeper`,`role`), `scoped_id` (nullable for a card-wide default), `rate_e4`, `currency` (ISO-4217, NOT NULL, CHECK), `valid_from` (`PlainDate`), `valid_to` (nullable). **Append-only versions** — a rate change inserts a new row with a new `valid_from`; existing rows are never edited (the effective-dating invariant). A partial UNIQUE index enforces one *open* row per `(rate_card_id, tier, scoped_id)` (`WHERE valid_to IS NULL`). **Closed-interval non-overlap is enforced in the service**, not the index (SQLite has no range-exclusion constraint): appending a version closes the prior open row's `valid_to = new valid_from` in the same batch and refuses a `valid_from` that lands inside an existing interval — a fitness test asserts no two rows for one scope overlap, so resolution (§3.2) always matches exactly one interval.

### 2.3 `utbms_code` — the code catalog (3·1 owns)
- `id` (`utbmsCode_`), `code_set` (CHECK: `task`,`activity`,`expense` — the ABA UTBMS families; expense/E-codes are seeded here for 3·3 to consume), `code` (e.g. `L120`, `A101`, `E101`), `label`, `practice_area` (nullable), `active`. Seeded from the published UTBMS sets as data; firms enable/disable, never invent ABA codes. _The internal-code→UTBMS mapping (the TimeSolv pattern in the research) is a **3·4 billing concern** and is out of scope here — 3·1 records the UTBMS code directly._

### 2.4 `non_billable_category` — firm-configurable
- `id` (`nonBillableCategory_`), `name`, `archived_at`. **Seed-and-fork:** provisioning seeds sensible defaults (Administrative, Business Development, Pro Bono, Training/CLE) which a firm renames/archives/extends — the defaults-not-locks pattern from 1·4.

### 2.5 Settings
Setting definitions owned by the timekeeping package, each with a zod schema + in-code default (a missing row is the default): `time.increment_minutes` (default 6 = 0.1 h), `time.rounding_direction` (`up`/`nearest`/`down`, default `nearest`), `time.approval_required` (default `false`), `time.abandoned_threshold_minutes` (default 600 = 10 h), `time.target_daily_hours` / `time.target_monthly_hours` / `time.target_annual_hours` (per-timekeeper targets, nullable — white paper's daily/monthly/annual). **Firm-level** values (`approval_required`, the targets, `abandoned_threshold_minutes`) use the flat `setting` seam (`packages/data-access/src/setting-statements.ts`); the **scope-overridable** ones (`increment_minutes`, `rounding_direction`) resolve through the scoped-setting resolver this slice builds (§2.6).

### 2.6 Scoped-setting resolver (net-new infrastructure 3·1 lands)
The flat `setting` seam stores one firm-level value per key (`SELECT value … WHERE key = ?`) and **cannot** do per-entity resolution — there is no scope/precedence resolver anywhere in the codebase today. But the white paper's own "increments are firm default with **per-client/per-matter override**" — and the owner's per-timekeeper extension (decision 7) — require one. So 3·1 lands a **scoped-setting resolver** (cheap-from-the-getgo, ADR-0078) as the **first realization of the white-paper settings-precedence chain**, kept minimal and reusable in `@magna-carta/data-access` — **this is net-new work, not reuse of the flat seam**:
- A `scoped_setting` table: `(key, scope_tier, scoped_id, value, updated_at)`, `scope_tier` CHECK in (`matter`,`client`,`user`,`location`,`firm`); `firm` rows carry a null `scoped_id`. System defaults stay in code.
- `resolveScopedSetting(key, { matterId, clientId, userId, locationId })` walks **most-specific-first** — matter → client → user → location → firm → in-code default — returning the first hit. A firm that sets only the firm-level value behaves exactly like the flat seam.

Later settings (theme, etc.) reuse this resolver; its scope is intentionally just the tiers the time settings need, generalized when a second consumer arrives.

---

## 3. Rate engine

### 3.1 Resolution
`resolveRate({ matterId, clientId, timekeeperUserId, roleId, workDate, rateCardId?, override? })` returns `{ rate_e4, rate_card_id, rate_source } | { noRate: true }`. **`clientId` is derived from the matter, `roleId` from the timekeeper's `member` record** at capture (re-derivable for an audit of `rate_source`, not snapshotted separately). Precedence, most-specific wins: **per-entry override → matter → client → timekeeper → role → card default.** The per-entry override sits at the top (six of nine competitors allow it — research). The card is chosen per matter/client (a matter can be on the "Insurance-capped" card); within a card, the tier rows resolve by `scoped_id`.

**No-rate result (the flat-fee/contingency + non-billable path, white paper line 646):** non-billable internal time resolves to `{ noRate: true }` — `rate_e4`/`rate_card_id`/`rate_source`/`amount_minor` stay null. Time on a **flat-fee or contingency** matter still resolves the standard rate and captures it (for the realization report, §8), even though 3·4 will not bill it hourly. So a null rate means "non-billable," never "flat-fee matter."

### 3.2 Effective-dating
Resolution filters `rate` rows to the one whose `[valid_from, valid_to)` contains `work_date`. **The entry snapshots the resolved `rate_e4` on capture** and keeps it forever — changing a card later never silently re-rates an existing entry (the white-paper "rate in force on its date" rule; the documented LEAP backfill bug we explicitly avoid — research).

### 3.3 Retroactive corrections (decision 8)
Amending a rate for a past period inserts a **new effective-dated `rate` version** (append-only). Consequences, by entry state:
- **Billed** entries: never change (append-only; corrections are new adjusting entries at billing).
- **Draft/Submitted/Approved** entries: keep their captured `rate_e4` by default. A **`reRateUnbilledDrafts(rateCardId, dateRange)`** action — gated by **`time:manageRates`** — re-resolves and rewrites `rate_e4`/`amount_minor` on unbilled entries in range (audited, batched) — opt-in, never automatic, so amounts never move silently.

### 3.4 Arithmetic
`amount_minor = round(rate_e4 × duration_minutes/60)` computed with `@magna-carta/money` (`multiplyByQuantity` → named rounding helper → `Money`); no floats. Rounding of the **billable quantity** (duration) is separate from money rounding — see §5.

---

## 4. The live timer — per-timekeeper Durable Object

### 4.1 Why a DO, and the cost posture
The requirement — one authoritative, single-active timer per person that survives tab-close, follows the user across devices, and self-detects abandonment — is the canonical DO use case (single-threaded coordination + the Alarms API + durable per-entity state; white paper "lives in DO durable storage, not memory"). **Cost is negligible by design:** the DO stores `startedAt` and **hibernates between interactions** (Cloudflare hibernates a DO seconds after idle); **elapsed time is computed client-side from `startedAt`, so the DO does not tick** and accrues no duration charge while a timer "runs." It wakes only for start/stop/pause/bind/read and the one abandoned-alarm — a handful of brief wakes per session. A typical firm sits inside the Workers Paid included tier; at platform scale it is order ~$10–15/month total. **The one pitfall, explicitly avoided:** never hold a non-hibernating connection open; if realtime cross-device push is added later, use the **WebSocket Hibernation API** (which suspends billing while idle).

### 4.2 Identity & tenancy boundary
One DO instance per timekeeper, `idFromName(\`${firmId}:${userId}\`)` — firm-namespaced, so a DO never holds another firm's state (tenancy invariant, ADR-0003). The DO holds **only transient live-timer state** in its own DO storage — `{ startedAt, pausedIntervals[], matterId?, label?, narrative?, utbmsCode?, lastActivityAt }`. **It is not a business-data store:** a committed time entry is **not** written by the DO. Commit flows through the normal path — a Worker route reads the DO's final state, composes a `time_entry` `EffectWrite`, and commits it through the data-access chokepoint into per-firm D1 (golden rule 3) — then tells the DO to clear. This keeps all business writes on the audited chokepoint and the DO as a pure coordinator.

### 4.3 Operations
`start` (stops any current timer — single-active, serialized by the single-threaded DO; mints a stable **`live_run_id`**), `pause`/`resume`, `bind(matterId, …)`, `read` (returns state; client computes elapsed), `stopAndCommit`, `discard`. **Scratch/unbound:** `start` needs no matter; `stopAndCommit` **refuses** an unbound timer with a typed error — bind first. "Resume-last-stopped" is a UI affordance over `start` pre-filled from a recent entry (no special backend).

**Stop-commit is idempotent on the `live_run_id` — this closes the double-commit race.** The DO serializes its own ops, but the `time_entry` is composed in the *route*, so two devices (or a double-tap, or a retry-after-slow-response) stop-committing the same run concurrently would otherwise mint two entries with two handles and two distinct route Idempotency-Keys — neither conflicting. So `stopAndCommit` is two-phase: (1) the DO does a single-threaded **compare-and-set** of its state to `committing` and returns the `live_run_id` — a second concurrent stop sees `already-committing` and gets the same id (or a typed `already-committed`); (2) the route derives **both** the chokepoint Idempotency-Key **and** the `timeEntry_` handle deterministically from `live_run_id`, so two racing commits collapse to one entry via `runIdempotentEffect`'s UNIQUE-key dedup. The DO clears only after the commit is confirmed.

### 4.4 Abandoned-timer alarm
On `start`, the DO sets an Alarms-API alarm at `time.abandoned_threshold_minutes` (default 600 = 10 h). **`stopAndCommit`, `discard`, and a replacing `start` cancel or reschedule the pending alarm** (`storage.deleteAlarm()` / re-`setAlarm`), so an alarm only ever fires for a still-live timer — no wake on an empty DO (preserving the §4.1 cost posture) and no spurious `abandoned` flag on an already-committed run. On fire, the timer is flagged `abandoned` (not auto-committed, not auto-discarded). Next interaction surfaces the resolution: **keep** (commit full), **trim** (commit to `lastActivityAt`), or **discard**. Input-level idle (mouse/keyboard) is a client signal that updates `lastActivityAt`; it stays in the 0·7 UI.

### 4.5 Offline (Tauri) reconciliation (decision 5)
The single-live-timer invariant is an **online** concept owned by the DO. An offline desktop session captures locally and, on reconnect, **submits completed Draft `time_entry` rows** through the normal commit path (`source = offline_sync`) — it does **not** contend for the live timer. Two devices therefore can never produce "two live timers," and an offline session is never lost. Idempotency on the offline client's entry id prevents double-commit on retry.

---

## 5. Increments & rounding (decision 7)

Two distinct, configurable knobs, both resolved through the **scoped-setting resolver (§2.6)** along `entity (matter/client) → user (timekeeper) → location → firm → system`, per-timekeeper available (research: PracticePanther exposes per-user):
- **`time.increment_minutes`** — the minimum billing increment (default 6 = 0.1 h); the raw captured duration rounds **to** this increment.
- **`time.rounding_direction`** — `up` / `nearest` / `down` (default `nearest`). Distinct from the increment (several competitors hard-code round-up; we make it a policy).

`raw_duration_minutes` is preserved; `duration_minutes` is the rounded billable quantity. Rounding the quantity happens before the money multiply; money rounding (to the minor unit) is `@magna-carta/money`'s and is separate.

---

## 6. Lifecycle & the optional review gate (decision 2)

States: **`draft` → (`submitted` → `approved`) → `billed`**, plus `void`.
- **`approval_required = false` (default):** the Submitted/Approved states are unused; entries go `draft` → `billed` at invoice finalize (3·4) — the white-paper frictionless path, unchanged for the default firm.
- **`approval_required = true`:** the timekeeper **submits** (`draft → submitted`, locks the entry to the timekeeper, editable by a reviewer); a reviewer **approves** (`submitted → approved`, billable) or **kicks back** (`submitted → draft`, with an audited reason). Only `approved` (or, when the gate is off, `draft`) entries are billable by 3·4.
- **`billed`** is the terminal lock (set by 3·4 in the same effect-batch as the A/R post). Post-bill corrections are **new adjusting entries**, never edits (the §2.1 freeze contract).
- A new **`time:approve`** permission gates submit-review/approve/kick-back.

This intermediate state is also the **host for the deferred passive draft-approve queue** (the slice map's note) — building it now keeps that seam cheap. **White-paper §17.1 will be amended** (on acceptance of the lifecycle ADR, currently Proposed) from "no approval workflow" to "an _optional_ firm-configurable review gate, default off" (§13).

---

## 7. Capture methods

- **Live timer** — §4.
- **Manual entry** — duration **or** start–end, free backdating (`work_date` settable). A one-line **quick-add parser**: `"0.5 Smith — drafted demand letter"` → duration `0.5h` + matter fuzzy-match `Smith` (against the firm's matters, surfaced for confirm — never auto-pick ambiguously) + narrative. Native (no competitor has a built-in parser; Clio's is AI-gated — research).
- **Weekly matters×days grid** — the bulk entry surface (one cell = one entry; **this is also the bulk-batch path**, satisfying that table-stake — research). All three input modes write the **same** `time_entry` WIP store, so totals stay consistent.
- **Calendar-derived drafts** — **seam.** The white-paper one-click "event → entry" needs the Phase-6 Calendar; `source = calendar` and the API shape are reserved, dormant until then.

**Narrative ergonomics** (white paper §17.1 "narrative ergonomics"; a competitive must-match — research). Backend lands now: a **per-task-code template** store (a template = `{ utbms_code?, narrative_template, default_rate? }` — the Clio "Activity Descriptions" pattern, fills narrative **and** rate together) and a **recent-narrative reuse** read (the timekeeper's recent distinct narratives, for one-tap re-pick). The inline **snippet/abbreviation expander** (space-bar expansion — TimeSolv) is a client-side editing affordance deferred to the 0·7 UI, though the snippet *definitions* store (per-user/firm) can land now; **voice-to-text** narrative entry is a noted seam (§15).

---

## 8. My Day (visibility)

Read-only projections over `time_entry` (never the ledger):
- Running **billable / non-billable totals** for the day (billable-only headline, non-billable behind a toggle — the MyCase pattern, research).
- **Billable-hour targets** (daily/monthly/annual per timekeeper, from settings — white paper §17.1) with a target-vs-actual read.
- **Missing-time = target shortfall** ("5.3 of 8.0 h logged") + **un-logged-day detection** (a working day with zero entries) — derived from time data alone (decision 10), since passive capture is deferred and no Calendar exists yet.
- **Calendar overlay** of un-billed events — **seam** (Phase 6).

Utilization/realization roll-ups are **3·6 Reports**, not here (the slice map's centralised-reports decision); 3·1 exposes the reportable columns (resolved rate, billable flag, raw vs rounded duration).

---

## 9. AI seam — the first AI feature, gated (decision 1)

The candidate **first AI feature**: time-narrative drafting + **UTBMS-code suggestion** from matter context. Reaches a model **only** through `InferencePort` (`packages/inference/src/port.ts` — `generateStream` for interactive drafting), with the model resolved per-firm at the call-site (`apps/worker/src/inference/call-site.ts`). **Differentiation (post-fact-check):** AI narratives are now market parity (Smokeball beta, Clio, Actionstep) — so the lead is **UTBMS-code suggestion** (unshipped across the field) delivered **web-natively + consent-gated** on the manual/timer flow, not behind a desktop agent or a paid SKU.

**Gated, shipped fast-follow:** the feature is dark until **ADR-0109 (client consent)** is Accepted (`aiProcessingEligibility` defaults OFF; privilege never rides an implicit yes). 3·1 builds the **producer seam** — the call-site over `InferencePort` and a stable **`InferenceJob` idempotency-key** structure. As the first real producer it also **fixes the design of the inference carry-forward**: the at-least-once queue consumer (`apps/worker/src/inference/inference-consumer.ts`) makes the model spend at `port.generate` **before** it commits, so a redelivery would both re-meter **and** re-bill a frontier model. Closing it needs **two** guards — both specified here, completed when the feature ships: (1) a **pre-model-call dedup read** on the idempotency key (skip the model call on a hit — this is what stops the **re-bill**), and (2) a dedup record composed into the **same batch as the metering write** (stops the **re-meter**). The same-batch record alone does not stop re-billing, because the spend precedes the commit. Cold-start: with no edit history, suggestions seed from UTBMS code definitions + matter context until per-user history accrues (an open question logged for the fast-follow).

---

## 10. Load profile (accretion rule)

Extend `packages/fixtures/src/load-profile/profile.ts` with a **TimeVolume** sub-profile (entries per timekeeper/day, rate-card depth, UTBMS-coded fraction, draft/billed mix), generated through the **real** capture/commit write path (valid by construction). Add a `time-measurements.ts` measuring the hot reads: My Day totals, the weekly-grid fan, the per-matter unbilled-WIP read (3·4's billing query), and rate resolution — each with `EXPLAIN QUERY PLAN` full-scan flagging. Bump the profile version.

---

## 11. Permissions, identifiers, coordination

- **Permissions** (`packages/access-control/src/registry.ts`) — **one namespace per subsystem** (house convention): `time:track` (create/edit own entries), `time:viewFirm` (see others' time, for firm-wide My Day / report gating), `time:approve` (the review gate), `time:manageRates` (rate cards + the `reRateUnbilledDrafts` action), `time:manageUtbms` (the catalog 3·3/3·4 read), `time:manageSettings` (the scoped time settings). Seeded to roles via the new migration; cross-checked by the conformance fitness test. (Rates and UTBMS stay under `time:` rather than their own namespaces, matching the existing one-namespace-per-package style.)
- **Identifier prefixes** (`packages/identifiers/src/registry.ts`): `timeEntry`, `rateCard`, `rate`, `utbmsCode`, `nonBillableCategory` (full words, golden rule 12).
- **Coordination pins (the slice map's cross-slice coordination):** **3·1 owns the UTBMS catalog** — land it before 3·3 consumes it. **Land the nullable `matter.e_billing` column in this slice's migration** (cheap-from-getgo) — a **hard prerequisite before any capture logic**, since code-required validation reads it; 3·4 reads it for export validation. The **scoped-setting resolver + `scoped_setting` table (§2.6)** are shared infrastructure this slice lands. Run `vp run worktrees` + sync `main` before editing the shared migration number, `access-control/registry.ts`, and `per-firm-schema.ts` (3·2/3·5 contend for the same).

---

## 12. Routes (API surface)

All through the ADR-0067 chokepoint, audited, idempotency-required on writes, `defineOpenAPIRoute` + the conformance suite + a regenerated OpenAPI snapshot (the recent `files.preview` precedent):
- `time-entries`: create (manual/quick-add/grid), list (My Day / weekly grid / per-matter), update (draft only), submit/approve/kick-back, void.
- `timer`: start / pause / resume / bind / read / stop-commit / discard (these proxy to the per-timekeeper DO).
- `rate-cards` + `rates`: CRUD (effective-dated), `reRateUnbilledDrafts`.
- `utbms-codes`: list/enable/disable.
- `non-billable-categories`: CRUD.
- `my-day`: the visibility read.

The quick-add parser is a read-shaped **preview** endpoint (parse → candidate matter/duration/narrative for confirm) then a normal create, mirroring `numbering-scheme/preview` from 1·1.

---

## 13. Documentation & decision changes

- **White paper §17.1** — amend the "Lifecycle — no approval workflow" line to "Draft → Billed by default; an **optional, firm-configurable review gate** (Draft → Submitted → Approved → Billed) is available, off by default." One home per fact; the rest of §17.1 is unchanged.
- **ADRs** (pending fragments): the lifecycle/review-gate decision; the per-timekeeper live-timer DO (with the cost posture); the effective-dated rate engine + retroactive-correction policy.
- **STATUS.md** — add the Phase 3 table with the 3·1 row (Spec `[x]`); ROADMAP 3·1 line updated to "designed."
- **User docs** — deferred with the UI (0·7), per the slice precedent.

---

## 14. Testing

TDD throughout. **Package suites** (`@magna-carta/timekeeping`): rate resolution (every precedence tier + per-entry override + effective-dating boundary + the **no-rate / flat-fee path** + retroactive re-rate), **rate-interval non-overlap** (the service refuses an overlapping `valid_from`), rounding (every direction × increment × scope), the **scoped-setting resolver** (most-specific-first across all tiers; firm-only behaves exactly like the flat seam), the lifecycle state machine (every legal/illegal transition; gate on/off), the quick-add parser, WIP-amount arithmetic + **currency round-trip** (money golden values; a `Rate`/`Money` is reconstructable from the stored columns), per-task-code templates. **DO tests** (Miniflare): single-active serialization, scratch→bind→commit, **two concurrent stop-commits on one `live_run_id` → exactly one entry**, **no alarm fires after commit/discard**, abandoned-alarm → keep/trim/discard, offline-sync-as-draft (+ idempotent re-submit), the firm-namespaced isolation. **Worker e2e** over the real HTTP surface: start timer → bind → stop-commit → quick-add → grid entry → (gate on) submit → approve → My Day reads → rate change keeps captured rate → retroactive re-rate of a draft → bill-locks at 3·4 seam. **Fitness:** the WIP-never-posts-to-the-ledger source scan (no `time_entry` write composes a `ledger_*` statement), the **freeze check** (no statement updates a `time_entry WHERE status IN ('billed','void')` beyond the billing lock), the permissions-vs-routes conformance check, and the load-profile plan-scan guard.

---

## 15. What this slice does NOT do (seams & deferrals)

- **WIP→A/R posting** — 3·4 (the only ledger touch-point; 3·1 leaves `packages/ledger` untouched).
- **The AI feature** — dark until ADR-0109; only the seam ships here (§9).
- **Calendar-derived capture + My Day calendar overlay** — Phase 6 Calendar seam (§7/§8).
- **Passive/automatic capture** — deferred (the three-tier taxonomy in the research); the matter-attribution + draft-queue host (the Submitted state) is the reserved seam.
- **All UI** + voice-to-text narrative entry — 0·7 / later.
- **Internal-code→UTBMS mapping** + LEDES export — 3·4.
- **Utilization/realization/productivity reports** — 3·6.
