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

## Structure

The surface mirrors `/settings`: a two-column shell where the left rail is persistent and each
section is its own route rendered in the right column.

```
┌ ACCOUNT ─────┐   ╔═ Profile ══════════════════════╗
│ ▸ Profile    │   Your identity within Magna Carta.
│   Security   │   ─ IDENTITY ─────────────────────────
└──────────────┘    Name        Magna Carta      [ Soon ]
                    Email        —                [ Soon ]
                    Avatar       (MC)             [ Soon ]

                   route: /account/profile
```

- **Left rail** — a single **Account** band (a person glyph beside a small-caps "Account" label on
  one hairline). One band, because every section here is the member's own — unlike settings, which
  bands by ownership across member / firm / platform. The rail lists the section pages; the active
  row carries the gilt start-edge bar, exactly as the settings rail does.
- **Right column** — the standard three-story page: masthead (information), the scrolling plates
  (the rows), no commit footer (there is no draft to commit — these are credential actions, not
  staged preference values).
- **Root route** — bare `/account` redirects to the first section (`/account/profile`), mirroring
  `/settings`, which redirects to its first section rather than rendering an index.

### Sections and rows (all honest seams)

**Profile** (`/account/profile`) — "Your identity within Magna Carta."

| Row    | Resting state | Becomes real when…                                  |
| ------ | ------------- | --------------------------------------------------- |
| Name   | `Soon`        | authentication ships a member profile               |
| Email  | `Soon`        | authentication ships a member profile               |
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

- `lib/account/account-sections.ts` — the account nav registry, mirroring the shape of
  `settings-sections.ts` (one canonical list the rail renders from) but its own data, so the surface
  stays decoupled from the firm-settings registry. Holds the single Account band and its section
  entries (id, label, href).
- `routes/(app)/account/+layout.svelte` — the two-column rail + content shell. Same nav markup and
  tokens as the settings `+layout.svelte`, sourced from `account-sections.ts`.
- `lib/account/components/account-masthead.svelte` — a lean masthead built on the design-system
  `Masthead.*` primitives (title + one-line meta). It intentionally omits the settings masthead's
  posture badge, documentation seam, and history ledger — those are settings-specific and do not
  apply to a credential surface.
- `routes/(app)/account/profile/+page.svelte` and `routes/(app)/account/security/+page.svelte` — the
  two section pages, each composing the account masthead + plates + seam rows.

**Flow change:**

- `lib/components/profile-menu.svelte` — the "Account Settings" `DropdownMenu.Item` changes from
  `disabled` (with a `Soon` badge) to a live navigation to `/account`; the `Soon` badge is removed.
  The scope line ("2FA, password, and profile") stays.

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
- Extracting a shared rail component across `/settings` and `/account`, should the two prove
  identical enough to warrant it.
