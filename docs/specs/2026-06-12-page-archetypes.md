# Page Archetypes — Magna Carta (slice 0·7a, Phase B)

**Status:** Owner-approved through the design-language workshop (2026-06-12, visual companion). The second human-judgment artifact (white paper, _Design quality & the design process_; ADR-0053). Pairs with [`2026-06-12-design-language.md`](2026-06-12-design-language.md); realizes §5 of [`2026-06-10-design-system-foundation-design.md`](2026-06-10-design-system-foundation-design.md) (ADR-0076).

**What this is:** the structural skeletons every real screen composes from — the app shell, the page archetypes, and two cross-cutting patterns — each with its layout grammar, information hierarchy, and full state set. Distinctiveness comes from the design language applied uniformly, **never per-screen customization**. This is design, not an implementation plan; specific screens are built (and refined at the per-tier owner design-review gate) in their feature slices.

**Reading note:** percentages/sizes are proportions and intent, not pixel specs. "Built where its surface lives" means the archetype is fixed here; the actual screen is constructed in the slice that owns it (Matters in 1·1, auth in 0·7b, etc.).

---

## 1. The app shell

The only fixed chrome; everything else renders inside it. **Layout A (Clio-familiar):** global sidebar on the left, and within a record a **header + horizontal tabs** above **full-width content**.

```
┌──────────┬──────────────────────────────────────────────┐
│  brand   │  top bar: ⌘K command · +New · timer · alerts · user │
├──────────┼──────────────────────────────────────────────┤
│ global   │  page/record header  (+ matter tabs, horizontal) │
│ sidebar  ├──────────────────────────────────────────────┤
│ (nav)    │  content  — FULL WIDTH                          │
│          │                                                 │
│ ─────    │                                                 │
│ pinned   │                                                 │
└──────────┴──────────────────────────────────────────────┘
```

**Why Layout A (not a second vertical sub-nav column):** it matches the mental model users arrive with, keeps the global sidebar, and gives content the **full width** that legal tables, the document host, and discovery review need. When a matter has many sections the tab row uses a **"More…"** overflow. A second column still appears _inside_ a specific view when the data needs it (a document folder tree, a list + filter rail) — that is a per-view choice, not permanent chrome.

### 1.1 Top bar

`⌘K` **command palette** (search + jump to any matter/contact/screen + run actions — the "fast" accelerator that reduces deep-nav reliance) · **+New** quick-create (capture matter/time/contact/task/note from anywhere) · a persistent **billable timer** (start/stop, attached to a matter, visible everywhere — a daily-driver feature) · **alerts** · **user/firm**. The timer and alerts are **seams now** (full features land in the Time and Notifications slices); the shell reserves their slots.

### 1.2 Global sidebar — a data-driven, role-filtered, phase-aware registry

The sidebar is **not a hardcoded list**. It is a **registry of destinations** that:

- **light up as their slice ships** (at/near launch only Matters, Contacts, and a Home exist; the rest appear as their phases land),
- appear only for **modules a firm has enabled**, and
- are **hide-in-place filtered by the user's effective permissions** (RBAC; slice 0·4 access-control).

**Canonical order, identical for everyone** — permission differences hide items in place; nothing reorders. A role's _default landing route_ may differ (a receptionist opens to Intake); the order never does.

**Canonical grouping** (labels are user-facing, phase tags indicate when each lights up):

- **Top:** Home · Matters (P1) · Calendar (P6) · Contacts (P1) · Tasks (P6) · **Intake** (P6)
- **Money:** Time (P3) · Trust (P3) · Billing (P3) · Payments (P6) · Accounting (P3)
- **Practice:** **Templates** (P2) · Discovery (P5) · Safe Custody (P4) · Conflicts (P4)
- **Firm:** **Tools** · Communications (P7) · Reports (P3)
- **Pinned bottom** (distinct region): Resource center · Settings · User profile · Collapse «

_(Addition 2026-07-02: **Tools** joins the Firm group — the tools-area left-nav destination
ADR-0101 assigns; the utilities are firm-wide, not matter-scoped, so Firm is its home.)_

_(Addition 2026-09-18: a **Communications** group stands between Workspace and Money, holding
Messaging and Meetings and whatever else carries a conversation with somebody outside the firm. The
rail's live grouping is the registry in `apps/web/src/lib/navigation/destinations.ts`, as regrouped
under the owner's rulings of 2026-09-16 and 2026-09-18 in
[`design-corrections.md`](../conventions/design-corrections.md); the list above is the original
sketch and is kept for the record.)_

**Templates, not Documents, in the global nav.** Actual matter files live in a matter's **Documents tab** (the File Manager). The global slot is **Templates** — the firm-wide reusable-document library + document automation (engagement letters, pleadings, letterhead, forms), a cousin of the future Forms module. A global cross-matter document/library view is deferred (handled by ⌘K search until a real need appears — cheap to add to the registry later).

**Intake & the triage handoff.** Intake is a reserved destination (Client intake / CRM, P6). Receptionists capture intake (the receptionist's default landing); on submit it **pushes/notifies** a supervising attorney into a triage queue; the attorney **decides** — accept (→ a _prospective_ matter per ADR-0080, or open a numbered matter), decline, or refer. Composes the Form (capture) and List/queue (triage) archetypes plus a status workflow; conflict-check ties to Phase 4; the push routes through Notifications.

The collapsed state is a thin **icon rail** (used in focus mode, §4-patterns).

### 1.3 Global ↔ matter context

The **global rail persists inside a matter** (firm-wide Calendar/Money/Templates always one click away). Entering a matter renders the **matter view** (header + horizontal tabs); returning is via the rail, a **breadcrumb** (Matters / _Pemberton v. Hale_), or the header back-link.

**Matters are real URLs** (`/matters/:id/...`), which gives deep-linking, the back button, and multi-open for free:

- **Open behavior:** click opens **in place**; **⌘/Ctrl-click or "Open in new window"** opens a separate view. **Web → a new browser tab; desktop (Tauri) → a native OS window.** Multiple matters/documents open at once is supported (same capability, platform-native mechanism — the parity rule, ADR-0023).

---

## 2. Navigation inventory — matter & contact

Records use the header + horizontal-tabs pattern (archetype 2). Tabs are a **core universal set + practice-area-type-specific tabs**.

**Matter tabs (core, every matter):** Overview · Documents · Time & Fees · Trust · Billing · Calendar & Deadlines · Communications · **Tasks** · Notes · Parties · Details — then **More…** overflow.

**Matter tabs (by practice-area type — appear based on the matter's type):** e.g. a Personal-Injury matter adds Damages · Settlement · Medical records. Type-driven tabs tie to **matter types as per-firm data** (ADR-0080) and the custom-fields engine; the mechanism is **seamed now, the type-configured tabs are a later feature.**

**Contact / Person tabs:** Overview · Matters · **Relationships** (the Directory graph — our addition over Clio) · Communications · Notes · Documents · Billing · Transactions. Same pattern, scoped to a person/org.

---

## 3. Archetypes

Four page archetypes. ("Editor" is deliberately **not** one — see §4-patterns.) Every archetype ships the full **state set** (§5).

### 3.1 List / Index

Matters, Contacts, the trust ledger, billing, the intake queue — the workhorse.

- **Default view: Table** (dense, virtualized rows; sortable, selectable, configurable columns; tabular figures for money/date). The fixed global chrome owns the only persistent shadow; rows are hairline-separated.
- **Alternate view modes** (switchable per list, part of a saved view): **Table + filter rail** (faceted filtering — Contacts, Discovery), **List + detail split** (master-detail triage — intake queue, contacts), **Board / Kanban** (status pipelines — matters by stage, intake, tasks).
- **Toolbar & power features:** **saved views** (named filter + columns + sort + view-mode sets, per-user and firm-shared — the backbone of a legal list), quick + advanced **filters**, **configurable columns**, **bulk actions** (selection bar → assign/tag/export/status/close), **grouping & multi-sort** (with subtotals on financial lists), **export/print** (respecting current filter + columns), the **view switcher**, and optional **inline quick-edit**.
- **Hierarchy:** toolbar (saved view · search · filters · view switch · columns · export) above the data; primary `+New` in the page header.

### 3.2 Record Detail

A matter — the header + tabs + content pattern. A directory record is **not** this archetype: the owner's ruling of 2026-09-05 ([`2026-09-02-directory-linking-design.md`](2026-09-02-directory-linking-design.md), the rulings section) is that a person or an organization has one surface, the entity window, which opens over whatever the reader was doing — the directory's list, a matter's parties, a conflicts hit — in the New Person screen's shape, and closes back to it. A record opened in place needs no way back, which is why it left the archetype.

- **Header:** breadcrumb, title, **status chip**, key metadata (number · type · responsible), and any contextual actions the record offers (_Add time_ · `New`), each named on the row. No overflow (⋯) menu: the owner's 2026-09-01 ruling ([`design-corrections.md`](../conventions/design-corrections.md)) is that a menu earns its glyph from what opening it offers, so one action goes on the row and no action draws no trigger.
- **Tabs:** the horizontal set (§2), gold-underlined active tab. A record with more sections than a row can hold GROUPS them into named menus on the row (the matter's Money · Record) rather than letting a measured overflow decide which half is visible — grouping only what a member can afford to reach through a menu, so a destination checked daily stays on the row; the More… overflow survives underneath as a backstop for a canvas narrower than the arrangement, and a group that reaches it keeps its name as a menu heading. See [`design-corrections.md`](../conventions/design-corrections.md).
- **Content:** full-width, archetype-appropriate per tab. The **Overview** tab is a focused dashboard of the record: a main column (recent **activity** timeline, **upcoming deadlines**) + a side rail (**financials** snapshot, **parties**, **details**).

### 3.3 Form / Wizard

New matter, intake, settings — any structured data entry.

- **Shapes:** single-column form, grouped-section long form, or **stepped wizard** (for long/branching flows like New Matter — a vertical step rail with done/active/upcoming states).
- **Field discipline:** constrained, readable measure (forms are never full-width); top labels; gold required markers; help text; paired fields in rows; the Form-field family (formsnap/superforms, Standard Schema).
- **Validation:** inline (red border + message at the field) **and** an **error-summary** banner at the top — the pattern every form inherits.
- **Actions:** sticky footer (Cancel · Save draft · Continue/Next →; Back in a wizard).
- **Two shells, one core:** the same form components render in the **app shell** (staff: dense, keyboard-driven) and, later, the **client portal shell** (branded, roomier, comfortable density, guidance + reassurance, no app chrome). This is why components are **shell-agnostic** (design-language §10). The portal shell itself is a Phase-6 archetype; the principle is locked now.

### 3.4 Dashboard

Home / "my day" — a personal, **role-aware** widget grid.

- **Composition:** a greeting + the **quote-of-the-day** (a ceremonial-edge heritage moment); **stat tiles** (billable today vs target, this week, unbilled, a gold "needs attention" tile); and widget cards — **My tasks** (overdue/today with matter context), **My matters**, **Today's schedule** (events + deadlines), **Needs attention** (trust alerts, intake-to-triage, conflict reviews). Glanceable; every widget drills into an archetype above.
- **Role-aware:** an attorney sees this; a receptionist's Home leads with the intake queue; a partner/admin gets firm KPIs — composed from role-relevant widgets.
- **User-arrangeable is a seam:** the dashboard is **widget-composed** so user arrangement/configuration (rearrange, add/remove) is a natural later addition. A sensible default layout ships first; the editing control is deferred.

---

## 4. Cross-cutting patterns (not page archetypes)

These were once lumped under a generic "Editor" archetype; for this product they are two distinct patterns used _within_ the archetypes above.

- **Collabora document host.** Office documents (`.docx/.xlsx/.pptx`) are edited in **Collabora** (WOPI host on the real file in R2; ADR-0010/0035) — Collabora provides the entire editing UI; **we build no document editor.** It opens in a **new window** (web → browser tab; desktop → native OS window), multiple at once. We may optionally embed it (an iframe with thin chrome — doc name, version, share, a properties inspector) for in-context editing; the default is open-in-new-window. Our contribution is the surrounding chrome, save-state, version access, and properties — not the canvas.
- **Rich-text authoring.** The native editing surface **we** build — used by **Notes** today (and reusable by any future native compose). Our toolbar, our design language, autosave/save-state, tags, attach. It lives **inside** a host archetype (e.g. the matter's Notes tab: a notes list + the open note's editor), which is why it is a pattern, not a page. (Email _composing/sending_ is **not in scope** — deferred to the Communications/Integrations spec, Phase 7; reading/logging email is a separate, also-unspecced concern.)

**Focus mode.** Editing/host surfaces may collapse the sidebar to its icon rail to maximize the canvas; the top bar keeps context (matter/document, save-state, Done/back).

---

## 5. The state set

Every archetype ships the full set; these are specified in writing (standard patterns), not mocked exhaustively:

- **Empty (initial)** — heritage empty state (e.g. the illuminated **M** watermark + a clear primary action: "No matters yet · New matter").
- **Loading** — skeleton rows/cards (no spinner-only screens).
- **Filtered — no results** — distinct from empty; "no matches" + a "Clear filters" affordance.
- **Error** — a recoverable message + Retry, surfacing the user-facing **Error ID** (golden rule 4 — `err_…`).
- **Dense / loaded** — the normal populated state at real data volume (virtualized where large).
- Form-specific: **validation error** (§3.3), **submitting**, **success**, **submit-error**.
- Host-specific: **read-only**, **version-view**, **conflict** (someone else editing).

---

## 6. Component implications (build hand-off)

The archetypes confirm the ~28-component inventory and add/clarify shell-level needs the component layer must cover: the **command palette** (Command/Combobox tier), the **app shell** (sidebar + collapse + top bar), **saved-views** and **view-switcher** controls on the DataTable, **status chips** (incl. legal statuses), the **stepper**, the **error-summary** + field-error pattern, the **billable timer** (a new shell component, seamed for the Time slice), and the **notification** slot. All components must be **shell-agnostic** (app shell + future portal shell). Building these is the slice 0·7a Phase D step, styled _to_ the design language and these archetypes; the per-tier **owner design-review gate** (ADR-0053) walks each batch in Storybook before the next tier starts.
