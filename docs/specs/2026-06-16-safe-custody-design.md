# Safe Custody — Design

**Status:** Design (brainstormed). Refines **ADR-0014** (Accepted: *location hierarchy + custody log + labels + scans + reminders*) with an MVP-first scoping. **Phase 4** (paired with Conflicts) — not yet sliced. Home concept: white paper, *Safe Custody*.

**One-line goal:** A register of the physical client originals and valuables a firm holds in safekeeping — what we hold, where it is, and whose it is — held to the professional-fiduciary standard, built MVP-first with the seams for a category-defining workflow engine left in place.

---

## 1. Why — positioning

Safe custody is a register of the **physical valuables and original documents** a firm holds for clients (original wills, deeds, codicils, powers of attorney, share/stock certificates, bearer securities, titles, and tangible items such as jewelry, keys, sealed instructions). The firm acts as a **bailee and professional fiduciary** — the duty to know exactly where each item is, whose it is, who deposited it, and to never lose or wrongly release it. The originals are irreplaceable and loss carries full-value, sometimes third-party, liability.

**This is near-uncontested US white space.** Safe custody is a Commonwealth (UK/AU/NZ) feature category. The mature products that have it either withhold it from US firms or ship a thin version:

- **Clio** and **Smokeball** build a safe-custody register but **region-gate it to AU/UK** — Smokeball stated publicly it does not plan to release the feature in its US product.
- **LEAP** ships it in the US, but as a shallow two-level packet→item list with a single free-text location field and no reminders.
- **MyCase, PracticePanther, Filevine, CARET, CosmoLex, Rocket Matter** — no native capability; physical custody is at best a hand-rolled custom field.

Even the mature products are shallow. **Universally absent across the whole field:** a structured multi-level physical-location hierarchy, true named-borrower check-out/return with signed receipts, native barcode/QR labels + scan-to-locate/stocktake, and any reminder engine (will-on-death, review, destruction, audit). The obvious next-tier features — the ones the regulatory and malpractice-carrier guidance already calls for — are unbuilt by everyone. That is the opening.

**We are positioned to win** because the platform already owns the primitives the incumbents lack: the **Location** office entity (the intended custody root; white paper, *Locations*), the **immutable-log** house pattern, **R2 scans**, the **retention/destruction engine with legal-hold blocking** (white paper, *Document versioning & storage tiering*), **Directory + Matter** linkage, the **Notifications registry**, and a **jurisdiction-keyed reference-data pattern** (the trust-rules catalog) reusable for will-deposit rules.

### The US legal frame (assembled, not a single mandate)

There is no US "safe custody register" requirement. The duties are assembled from:

- **ABA Model Rule 1.15** — safekeep client property with the care of a *professional fiduciary*; keep "complete records … available for examination." Retention default **5 years** (Model/TX), **7 years** (NY, IL). Rule is numbered **1.14 in Texas**; California and Florida adapt it differently. Wills/deeds/securities of intrinsic value sit **outside** the routine retention clock and are generally never destroyed.
- **Model Rule 1.16(d)** — return client papers and property on termination.
- **State will-deposit statutes** with real teeth — e.g. **Florida §732.901** (deposit the original within **10 days** of death), **California §8200** (**30 days**; original to court, copy to executor; liable for all damages), **Texas Estates Code ch. 252** ("on notice," enforced by *arrest* of a non-complying custodian + damages). A lost original held in the *firm's* custody is not presumed revoked, but forces costly lost-will litigation and direct malpractice exposure.

These rules vary materially by state, which is why the will-on-death engine is modeled as a per-state catalog rather than hard-coded — and why, for the MVP, it is deferred entirely (see §4).

---

## 2. Goals

1. **Ship a durable, low-maintenance register first** — log items, their physical location, ownership, scans, and a status history. No machinery that needs ongoing upkeep (statutes, reminder cadences).
2. **Be category-defining over time** — the design leaves seams so the differentiating workflow engine (will-on-death deadlines, gated release, stocktake reconciliation, reminders) slots in as later slices without schema rework.
3. **Reuse, never rebuild** — Locations, immutable logs, R2, retention/legal-hold, Directory/Matter, Notifications, PortalGrant, and the trust-rules-style catalog pattern.
4. **Orphan-prevention is structural** — an item cannot exist without an owner link.

### Non-goals

- The firm's **own** asset register (equipment, depreciation, insurance) — a different duty (firm property, not client property); a possible future cousin, out of this subsystem.
- Encoding all 50 states + DC of will-deposit law up front.

---

## 3. MVP — the register (ships first)

Low-maintenance core: **what we hold, where it is, whose it is, with a status history.**

### Domain model

- **Item** — `type` (configurable list: original will, deed, codicil, power of attorney, share/stock certificate, bearer security, title, jewelry, keys, sealed envelope, USB drive, other); `description`; `intrinsicValueFlag` (marks an irreplaceable original — a seam the later destruction logic reads); **owner(s)** — at least one **Directory** link, mandatory; **co-ownership form** (joint tenancy / tenancy-in-common — captured now because it determines release authority later, cheap as data today); **depositor** (who physically handed it over, may differ from owner); optional **matter** link; R2 **scan(s)**; **barcode/QR** label; current **container**; **status**.
- **Container** — a **recursive** tree (a container holds sub-containers or items) **rooted at a Location** (the existing office entity; white paper, *Locations*). Common default shape `safe → box → position`, but a firm can model room → safe → shelf → deed-box → packet → position as deep or shallow as its real storage needs. Each container carries a **barcode/QR** label. In the MVP this is pure data ("this packet is in box 3 in the Reno safe") — no stocktake workflow.
- **Custody ledger** — append-only (the immutable-log house pattern). One entry per event — logged, location-moved, checked out, returned, released, destroyed — with `actor`, `timestamp`, `note`. This is *record-keeping, not enforced workflow*: in the MVP no action is hard-gated.

### MVP capabilities

- Log / edit / retire items with the fields above.
- Place items in the container tree and move them between containers (ledger entry each time).
- Attach R2 scans to an item.
- Print **barcode/QR labels** for items and containers (low-maintenance; no scanning/reconciliation yet).
- Record status changes and temporary check-out / return as ledger entries (who / when / note) — frictionless, no hard block.
- Basic register views: items held per client, items held per location, item detail with full custody history.

---

## 4. Deferred — the workflow engine (later slices)

Designed-for via the MVP seams (`status`, `intrinsicValueFlag`, container tree, ledger), built when the firm is ready to maintain them:

- **Will-on-death engine** — a jurisdiction-keyed will-deposit catalog (same pattern as the trust-rules catalog): per-state `{deadline, deadline-trigger, release-vs-lodge rule, authority basis, penalties}`. A death-trigger captures date/source + certified death certificate, starts the **statutory deadline clock**, drives the **release-vs-lodge branch** (original→court vs. release-to-personal-representative), and the **authority gate** (Letters Testamentary/Administration; power of attorney hard-stops at death). **Ships with Nevada only** at first build, with a safe generic "review on death" reminder for un-encoded states; more states added incrementally. Nevada's exact rule (NRS) is verified against statute at build time, not encoded from memory.
- **Gated release** — block release of an item until identity + authority are logged and a signed receipt is generated; authority branches on life-vs-death and co-ownership form.
- **Stocktake / reconciliation** — scan a container, reconcile expected vs. actual contents, emit a discrepancy report (the annual-audit best practice carriers reward).
- **Reminder engine** (via the Notifications registry) — will-on-death statutory deadline (escalating), review dates, retention/destruction dates, periodic stocktake.
- **Retention/destruction automation** — per-item-type retention clock; `intrinsicValueFlag` originals carry a do-not-destroy block; permissible destruction gated on authority; **any legal/discovery hold suspends it** (the existing engine; white paper, *Document versioning & storage tiering*).
- **Intake receipt + portal visibility** — generate a signed deposit receipt on intake; optionally surface "items we hold for you" (and scans) to the client through the existing **PortalGrant** model.
- **Succession / transfer manifest** — exportable, reconcilable inventory with a successor-custodian field and dual sign-off, so custody survives firm merger/closure (the single biggest cause of bulk loss).
- **Unclaimed / can't-locate-client handling** — a do-not-destroy state with logged contact attempts; routes originals to indefinite retention rather than escheat.
- **Two-signatory release** — an optional firm setting layered on the gated-release flow (depositing solicitor + manager).

---

## 5. Integrations (reuse map)

| Need | Reused system |
| --- | --- |
| Custody container root (office) | **Locations** (white paper, *Locations*; ADR-0068) |
| Item ownership + matter linkage | **Directory** + **Matters** |
| Digital scans (bulk bytes to R2) | **file-manager / R2** (golden rule 3) |
| Append-only custody ledger | immutable-log house pattern |
| Destruction guardrails + legal holds | **retention/destruction engine** (white paper, *Document versioning & storage tiering*) — deferred slice |
| All reminders | **Notifications registry** — deferred slice |
| Client visibility of held items | **PortalGrant** — deferred slice |
| Per-state will rules | trust-rules-style **jurisdiction catalog** — deferred slice |

---

## 6. Open items to resolve at spec/plan time

- Exact **Nevada** will-custodian statute (NRS) — deadline, release-vs-lodge rule, authority basis — verified against primary text before encoding (deferred-slice work).
- Per-item-type **retention defaults** (deferred-slice work).
- **Receipt** template and **portal** visibility granularity (deferred-slice work).
- Whether the MVP-first scoping warrants an **ADR-0014** update at plan time (golden rule 8).

---

## 7. References

- White paper: *Safe Custody*, *Locations*, *Document versioning & storage tiering*, *Tenancy and data isolation*.
- ADR-0014 (Safe Custody), ADR-0068 (Locations as view/reporting dimension), ADR-0003 (firm-scoped data-access), ADR-0078 (cheap seams up front).
- Competitive analysis: safe custody as a US-market strength.
