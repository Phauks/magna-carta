# Account Settings surface — design

**Date:** 2026-07-10
**Status:** Design (approved in brainstorm; spec under owner review)
**Stream:** `account-settings` (branched off `slice-0-7b-app-shell`)

## Purpose

Build the **Account Settings** surface — the person-scoped identity and credentials surface reached
from the profile menu — as an honest-seam scaffold, plus the flow that carries a member from the
profile-menu item into it.

Account Settings is deliberately **separate** from `/settings`. The settings surface carries work
preferences and firm policy; a member's own identity and credentials (profile information, password,
two-factor, sessions) are a different kind of thing and live in a higher-ceremony surface where
step-up re-authentication will sit when authentication ships. This split is owner-settled; the
settings section registry already records the absence of an "account" group for exactly this reason.

## Scope

**In scope now:**

- A new `/account` surface mirroring the settings shell's structure: a persistent left rail plus one
  route per section.
- Two sections: **Profile** (`/account/profile`) and **Security** (`/account/security`).
- Every control an **honest seam** — a disabled control with a `Soon` badge — because nothing here
  can function before authentication. This follows the existing seam pattern (the Text and Beta
  Access settings pages).
- The **flow**: the profile-menu "Account Settings" item becomes a live link into the surface; its
  `Soon` badge drops.

**Explicitly out of scope (arrives with authentication):**

- Any real read or write of profile/credential data; any session or sign-out behaviour; step-up
  re-authentication. `Sign out` stays in the profile menu, inert, as it is today.

## Structure — a standalone secure surface

Account Settings is a **walled-off surface, not a page inside the app shell.** Because it governs
high-stakes personal operations (credentials, sessions, and — on the sibling admin surface later —
other people's access), the workspace chrome falls away: no app sidebar, no app top bar, none of its
tools (search, the timer, notifications, the profile menu). Removing that chrome is the separation —
the quiet, stripped frame signals that the member has stepped into a more serious mode. The surface
therefore lives **outside the `(app)` route group** (which is what wraps every ordinary surface in
the App Shell) and renders in its own **Secure Shell** instead.

```
╭ M  MAGNA CARTA ───────────────────────────────────── ✕ ╮   ← stripped chrome band
├ ACCOUNT ─────┬─────────────────────────────────────────┤
│ ▸ Profile    │  Profile                                 │
│   Security   │  Your identity within Magna Carta.       │
│              │  ─ IDENTITY ─────────────────────────────│
│              │   Name    —    [ Soon ]                  │
│              │   Email   —    [ Soon ]                  │
│              │   Avatar  MC   [ Soon ]                  │
╰──────────────┴─────────────────────────────────────────╯
                                       route: /account/profile
```

- **Stripped chrome band (the Secure Shell header)** — the Magna Carta brand mark on the left (→
  Home, the universal convention and one honest way back to the workspace) and a **Close (✕)** on the
  right. Nothing else. Chrome-register surface, where the brand mark belongs.
- **Left rail** — a single **Account** band (a person glyph beside a small-caps "Account" label on
  one hairline). One band, because every section here is the member's own — unlike settings, which
  bands by ownership across member / firm / platform. The active row carries the gilt start-edge bar,
  the same device the settings rail uses.
- **Content column** — the three-story page: masthead (information) + the scrolling plates (the
  rows). No commit footer (there is no draft to commit — these are credential actions, not staged
  preference values).
- **Root route** — bare `/account` redirects to the first section (`/account/profile`).

### Navigation — how you enter and leave

- **Enter:** the profile menu's "Account Settings" item navigates (same window) to `/account`. It
  does not open a second window — a second window is jarring, popup-blocked, and awkward on tablets,
  and the stripped chrome already delivers the separation without those costs.
- **Leave (two honest exits):** the **brand mark → Home**, and **Close (✕) → the screen you came
  from** (the Escape key does the same). Close returns to the surface's **entry point — captured
  once, when the member enters** — so moving between the surface's own subpages never changes it and
  Close always leaves the _whole_ surface, never steps back one subpage. Reached directly (a full
  page load, no in-app origin) it falls to Home. Plain navigation throughout — no `window.close`.

### Sections and rows (all honest seams)

**Profile** (`/account/profile`) — "Your identity within Magna Carta."

| Row    | Resting state | Becomes real when…                                   |
| ------ | ------------- | ---------------------------------------------------- |
| Name   | `Soon`        | authentication ships a member profile                |
| Email  | `Soon`        | authentication ships a member profile                |
| Avatar | `Soon`        | authentication ships a member profile + avatar store |

**Security** (`/account/security`) — "How you sign in and protect your account." The higher-ceremony
half; step-up re-authentication lands here with authentication.

| Row             | Resting state | Becomes real when…                          |
| --------------- | ------------- | ------------------------------------------- |
| Password        | `Soon`        | authentication ships credential management  |
| Two-Factor      | `Soon`        | authentication ships 2FA enrolment          |
| Active Sessions | `Soon`        | authentication ships session listing/revoke |

Rows use Title Case names (owner-directed for setting/page names); descriptions stay sentence case.

## Components and reuse

The reuse strategy is **a parallel surface that reuses the presentational parts** — not a refactor of
the shipped settings shell, and not a new "account" branch inside the settings registry.

**Reused as-is (not modified):**

- `settings/components/settings-plate.svelte` — a category group of rows; fully generic (heading +
  children), no settings-registry dependency.
- `settings/components/settings-row.svelte` — one engraved-table row. Its `control` snippet is the
  built-in escape hatch for "a seam row's Soon device"; each account row supplies a page-local
  definition (id / label / description) and renders a disabled control + `Soon` through that snippet,
  exactly as the Text and Beta Access pages do.

**New (this stream):**

- `lib/components/secure-shell.svelte` — the **reusable Secure Shell**: the stripped chrome band
  (brand mark → Home; Close ✕ / Escape → previous screen) and the two-column frame (a `rail` snippet
  beside `children`). It owns only the chrome and the frame; each secure surface supplies its own
  rail and content. Deliberately not the App Shell. Built to be reused by the firm-user
  administration surface (see _Deferred_).
- `lib/account/account-sections.ts` — the account nav registry, mirroring the shape of
  `settings-sections.ts` (one canonical list the rail renders from) but its own data, so the surface
  stays decoupled from the firm-settings registry. Holds the single Account band and its section
  entries (id, label, href).
- `routes/account/+layout.svelte` — renders the account rail (from `account-sections.ts`) into the
  Secure Shell. Lives **outside `(app)`**, so it never inherits the App Shell.
- `lib/account/components/account-masthead.svelte` — a lean masthead built on the design-system
  `Masthead.*` primitives (title + one-line meta). It intentionally omits the settings masthead's
  posture badge, documentation seam, and history ledger — those are settings-specific and do not
  apply to a credential surface.
- `routes/account/profile/+page.svelte` and `routes/account/security/+page.svelte` — the two section
  pages, each composing the account masthead + plates + seam rows.
- `routes/account/+page.ts` — the bare-`/account` → `/account/profile` redirect.

**Flow change:**

- `lib/components/profile-menu.svelte` — the "Account Settings" `DropdownMenu.Item` changes from
  `disabled` (with a `Soon` badge) to a live same-window navigation to `/account`; the `Soon` badge
  is removed. The scope line ("2FA, password, and profile") stays.

## Why not reuse the settings masthead or nav directly

The settings masthead is coupled to the settings section registry (documentation-path lookup,
history ledger) and speaks a settings vocabulary (posture badges: "Applies on save" / "Managed by
the firm"). None of that fits a credential surface, and faking a settings section to satisfy it would
reintroduce the very coupling the taxonomy removed. A lean account masthead on the shared
`Masthead.*` primitives keeps the identical visual language without the coupling. The rail is copied
as a structural pattern (same markup, same tokens) sourced from the account registry, for the same
reason. If the two rails later prove identical, extracting one shared nav component is a clean
follow-up — deferred rather than done speculatively for two consumers.

## Honest-seam discipline

No control here pretends to work before authentication. Every row is a disabled control carrying a
`Soon` badge (the badge states why the control is inert) — the deliberate honest-seam device, the
same one the Text and Beta Access pages use. The shell never fakes function; every seam is an honest
seam.

## Testing

- **Registry well-formedness** (pure-data, node): every `account-sections.ts` entry has a unique id
  and a unique `href`, and each `href` matches an existing route. This is the account analogue of the
  settings mode-purity test — a fitness check over the registry, no browser.
- **Render/seam assertion** (component): `/account/profile` and `/account/security` each render their
  masthead and every declared row, each row carrying a `Soon` badge with no enabled input — so a real
  control can never land silently before authentication without a deliberate change to the test.
- **Root redirect**: bare `/account` redirects to `/account/profile`.

## Documentation

- This spec.
- A `changelog.d/` fragment.
- One cross-reference line in `docs/conventions/settings.md` pointing to Account Settings as the
  sibling surface for person-scoped identity/credentials.
- The `docs/active-work/account-settings.md` stream note (already added).

## Deferred

- All real profile/credential behaviour, sessions, sign-out, and step-up re-authentication — they
  arrive with authentication. Each is named here so the seams say honestly what they are waiting for.
- **Firm-user administration surface** — managing other members (invite / remove, roles &
  permissions, resetting someone's access) is as high-stakes as personal credentials and belongs in
  the same elevated zone: a **separate surface** (admin-only, permission-gated, step-up + audit) that
  **reuses the Secure Shell** with its own rail and access. Kept separate from this personal Account
  surface — "my credentials" and "managing the firm's people" are different mental models that should
  not share one rail. A follow-on slice; the shell is built here to receive it. (There is an existing
  `/settings/users` roster under Firm Settings; whether the sensitive actions move into this elevated
  surface is that slice's design decision.)
- Extracting a shared rail component across `/settings` and `/account`, should the two prove
  identical enough to warrant it.
