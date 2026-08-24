# Handover — the matter screens

Written for a fresh instance picking up the matter surfaces cold. It covers three things: what the
file-manager rounds taught about building UI here, where sign-in actually stands, and the brief for
the screens that come next.

Read [`CLAUDE.md`](../../CLAUDE.md) first — this document assumes its golden rules rather than
repeating them.

---

## 1. What the file-manager rounds taught

Eight rounds of owner review went into one screen. Almost every correction was a repeat, and the
repeats are the lesson.

### The owner's standing rulings live in one file, and they bind

[`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md) is a numbered
ledger of every ruling the owner has issued on this surface — roughly 140 entries, each `settled`,
`open`, `regressed` or `superseded`. Several apply well beyond the file manager:

- **We do not draw glyphs.** Every icon is Lucide, from the installed `@lucide/svelte` package.
  Where Lucide has no icon for a thing, the answer is the nearest Lucide icon. The design system's
  `FileIcon` already does this; use it rather than mapping types yourself.
- **Nothing is ever blocked.** A file that failed a scan is still stored, still shown where its
  owner put it, and still downloadable. A flag is a note, not a gate. Refusing to save or show a
  file is the greater hazard.
- **No inert controls.** A button that looks live and does nothing is the single most-repeated
  complaint in the ledger. Either wire it, or render it disabled with a `Soon` badge saying what it
  waits on.
- **Say what a control will do.** "Select all" that becomes "Select none" beats two buttons where
  one is always the wrong one to press. "Delete" on a soft delete says the file moves out of the
  list and stays recoverable, because that is what happens.
- **A rename never selects the extension.** Raised three times as a critical file error.
- **A view that is not a place in the folder tree titles the breadcrumb**, rather than inventing a
  path or adding a second heading beneath it.

### The failure mode that cost the most: a check that tests the wrong property

`tooling/file-manager-rulings/index.mjs` is a headless-Chromium harness — 79 checks, run with:

```
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tooling/file-manager-rulings/index.mjs <path-to-mockup>
```

It exists because two rulings read `settled` in the ledger while the screen still had the defect.
Both times the check asserted something adjacent to the complaint rather than the complaint itself:

- The owner asked twice for the dark fill behind an active sidebar toggle to go. The rule set
  `box-shadow: none`; the check asserted `box-shadow === "none"` and passed every round while
  `background: var(--mc-surface-selected)` sat there untouched.
- The owner asked twice for square colour swatches. `.menu button` sets a corner radius and
  outranks a bare `.swatch`, so nothing changed — and the check only asserted the radius was not a
  circle, which a 2px radius satisfies.

**The rule that came out of it:** assert the property the person actually named, measure it the way
they would see it (with the pointer parked away, since `:hover` legitimately changes a surface), and
prefer an exact comparison to a "not obviously wrong" one. When a check and a complaint disagree,
the complaint is right.

Run the harness FIRST each round, before making changes. It catches what the previous round undid.

### Working method that survived

- **Edit big files step by step, writing after each step.** Two earlier sessions lost a batch of work
  by building the whole edit in memory and writing at the end. The mockup editor
  (`scratchpad/fm/ed.py`) writes on every successful step and runs `node --check` on the extracted
  script before it does, so a later failure never discards earlier work.
- **A pattern that matches nothing is a failure, not a no-op.** Every edit asserts it changed
  something. Silent misses are how a "fixed" item reaches the owner unfixed.
- **Verify in a browser, not by reading the diff.** Three defects this session were only visible when
  rendered: icons pinned to 2px by a regex that matched `stroke-width="2"`, a class rule silently
  defeating the `hidden` attribute, and a dialog growing tall enough to push its own Close button
  off-screen.

### Design-system facts worth knowing before you start

`packages/design-system` already carries far more than it looks like from the outside. Before
building any of these, check there:

`resizable` (paneforge — drag, keyboard resize, separator semantics) · `tree` (full WAI-ARIA tree
keyboard model, controlled expansion) · `context-menu` and `dropdown-menu` (Bits UI) · `data-table` ·
`breadcrumb` · `file-icon` (resolves to Lucide) · `command` · `combobox` · `sheet` · `toast` ·
`empty-state` · `skeleton` · `dropzone` · `date-picker` · `merge-field-picker`.

Two contract details that will bite:

- `ContextMenu.Trigger` renders its own element and strips the `child` snippet, so it cannot wrap a
  `<tr>`. Put ONE context menu around the whole table and record which row the `contextmenu` event
  landed on. `apps/web/src/lib/file-manager/file-list.svelte` does this.
- `Breadcrumb` takes `{label, href}`. Folder navigation that changes state rather than the address
  needs buttons instead.

---

## 2. Sign-in: where it actually stands

**It exists and it works.** `/login` renders `$lib/auth/screens/sign-in-screen.svelte`; the `(app)`
route group is guarded in its `+layout.ts` load and redirects an unauthenticated visitor there. The
server side is Better Auth on the control-plane database (`apps/api-worker/src/auth.ts`) with
**email and password** plus the **two-factor plugin** (one authenticator secret and backup codes)
genuinely mounted. Registration exists too: `/register/firm`, `/register/invitation`,
`/register/confirm`.

**What is honestly missing** is declared in one place — `$lib/auth/unbuilt-capabilities.ts` — and
every surface reads its state from that list rather than hard-coding a flag. Do not add a capability
to a screen without deleting (or narrowing) its entry there:

| Capability               | What is missing on the server                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Passkey / security key   | The Better Auth passkey plugin is not mounted — no registration or assertion route, no credential store.                              |
| One-time sign-in link    | The magic-link plugin is not mounted. Password reset sends mail but resets a password rather than establishing a session.             |
| Firm identity provider   | No `socialProviders` configured; nothing resolves an address to a firm's provider and there is no redirect target.                    |
| Human verification       | The server verifies a Turnstile solution on the two joining endpoints, but nothing mints one and the sign-in endpoints are not gated. |
| Choosing a second factor | One authenticator secret plus backup codes; no enrolled phone channels or email codes to choose between.                              |
| Choosing a workspace     | Nothing publishes the firms a signed-in person belongs to, and no route records a default.                                            |
| Reset by typed code      | Reset is a link carrying an opaque token; the emailOTP plugin is not mounted.                                                         |

**The real blocker is not code.** Two things gate anyone actually signing in to a deployed
Magna Carta, and neither can be done from a session:

1. **GitHub Actions has been blocked account-side since 2026-08-05** — a billing step. The gate of
   record has not run since. Every merge in that window landed on local verification alone.
2. **Production deploys are deliberate and owner-only** (`git push origin main:release`; the Workers
   Builds production branch is `release`, not `main`). Two projects also need their root directory
   repointed in the Cloudflare dashboard.

Both, with the exact steps, are in [`docs/deploy-queue.md`](../deploy-queue.md). Read it before
telling the owner anything is ready to use.

The design behind the missing methods is already written —
[`2026-08-13-unified-identity-design.md`](../specs/2026-08-13-unified-identity-design.md) and its
[implementation plan](../specs/2026-08-13-unified-identity-implementation-plan.md) cover passkeys,
magic links, firm SSO and client-portal identity. Building any of them is a slice against that
spec, not a fresh design.

---

## 3. The brief: the remaining matter screens

`apps/web/src/lib/matters/sections.ts` is the registry of the matter's sections. Where each stands
today:

| Section                                       | State                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                                      | Built — key facts, description, honest "Soon" tiles for figures that need time and trust flowing.                                                   |
| **Files**                                     | Built this session — the three-pane file manager. See below for what is NOT ported.                                                                 |
| **Time**                                      | Built — every entry on the matter, read from the firm's record. Ready for a design pass.                                                            |
| **Costs**                                     | Built — every disbursement advanced. Ready for a design pass.                                                                                       |
| **Billing**                                   | **A stub.** `SectionStub` and nothing else.                                                                                                         |
| **Parties**                                   | Built — who is on the matter and in what role.                                                                                                      |
| Notes                                         | **A stub.**                                                                                                                                         |
| Trust, Custodian, Messaging, Emails, Calendar | Varies; check each. Trust in particular has a live open item: no route opens or lists a trust account, so the subsystem is unreachable from the UI. |
| **Other**                                     | **A stub** — and the container for the sections nested under it.                                                                                    |

### How to approach them

**Talk to the owner before new UI work.** This is a standing instruction, stated in capitals more
than once: _"BEFORE NEW UI WORK, TALK TO ME FOR CONFIRMATION."_ The file manager took eight rounds
partly because the first version was built without asking. Show a mockup, get the corrections, then
build.

**The mockup route works and is worth repeating.** A single self-contained HTML file, published as
an artifact, reviewed by the owner in rounds, with every ruling recorded in a ledger and pinned by a
browser check. The file manager's is
[The Docket](https://claude.ai/code/artifact/a8eff55d-adb2-4805-9dc5-27ccb7c0c8cb), revision 5, and
its working copy is in this session's scratchpad. Two other published mockups exist — The Workbench
and The Folio — from earlier surfaces.

**Backends mostly exist.** Time, costs, billing, trust, calendar and custodian all have merged
designs, plans and in many cases built slices; the register at [`docs/now.md`](../now.md) says which,
and [`roadmap.d/`](../../roadmap.d/) is the source it renders from. Read the register before
assuming something needs building — several subsystems are complete server-side and simply have no
screen.

**Billing has the most design behind it and the least UI.** Invoices over time with costs and trust
application, [billing automations](../specs/2026-08-16-billing-automations-design.md) and
[payments](../specs/2026-08-15-payments-design.md) are all designed and partly built, and the screen
is a stub. The owner's standing direction there was per-matter invoice pages.

**Notes has a design too** —
[notes and activity](../specs/2026-08-15-notes-and-activity-design.md), with
[tasks on top of it](../specs/2026-08-15-tasks-and-matter-plans-design.md).

### What is NOT ported in the file manager, so nobody rediscovers it

The Files screen now has the folder tree, the column-managed sortable list, multiple selection, a
working right-click menu (Open, Download, Rename, Delete) and the details panel, in three resizable
panes. Still only in the mockup:

File Analysis (the findings view, with severity counts and ignore/unignore) · Deleted Files (on the
matter's own table, sortable by deletion time) · archive browsing · the icon-grid layout · folder
colour and icon · pinning · the in-list rename field (rename is a prompt for now) · drag-and-drop
between folders.

Each is its own slice over endpoints that mostly exist. The mockup is the reference for what they
look like; the ruling ledger is the binding list of what they must do.

### Open owner questions on this surface

- **P7** — "Open" versus "Open in Editor". My view: Open should just open the editor and the second
  item disappears. It touches the editor launch path, so it needs the owner's call.
- **P16** — a document showing who has it open, live. The owner raised it themselves when answering
  the checkout question and called it "interesting"; designed here, not built.
- **P3** — where a restored file goes when its original folder is gone.
- **P8** — how concurrent authorship is credited.

Two answers already given, and binding: **a checkout is not a lock** (editing runs through Durable
Objects, so other people can still edit a checked-out file), and **icons are always Lucide**.

---

## Where to look next

[`CLAUDE.md`](../../CLAUDE.md) — the rules and the map ·
[`docs/now.md`](../now.md) — every capability at its real status ·
[`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md) — the owner's
standing rulings on this surface ·
[`docs/conventions/design-corrections.md`](../conventions/design-corrections.md) — their standing
design rulings generally ·
[`docs/deploy-queue.md`](../deploy-queue.md) — what only the owner can do.
