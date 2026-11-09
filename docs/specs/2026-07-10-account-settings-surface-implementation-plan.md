# Account Settings Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/account` (Account Settings) surface — a person-scoped identity/credentials surface reached from the profile menu — as an honest-seam scaffold, plus the profile-menu → surface flow.

**Architecture:** A parallel surface that mirrors the `/settings` shell structure (persistent left rail + one route per section) but keeps its own small nav registry, so it stays decoupled from the firm-settings registry the taxonomy deliberately excludes it from. It reuses the settings presentational parts (`SettingsPlate`, `SettingsRow` via its `control` snippet) unchanged, and adds a lean masthead built on the design-system `Masthead.*` primitives. Every control is an honest seam (a disabled control + a `Soon` badge) because nothing here functions before authentication.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, `@magna-carta/design-system`, Vitest (node pool), Tailwind v4 semantic tokens.

**Worktree:** `C:/dev/magna-carta-worktrees/account-settings` (branch `account-settings`, off `slice-0-7b-app-shell`). All paths below are relative to that worktree root.

## Global Constraints

Every task's requirements implicitly include these (copied from the project golden rules and the spec):

- **Design-system only.** UI is built solely from `@magna-carta/design-system` components + Tailwind semantic utilities. No raw CSS, no off-token color/length literals, no `bits-ui` imports. Lucide icons only. **No emojis** anywhere (UI, docs, commits).
- **Token purity.** Every color/spacing value resolves through a design token (`--mc-*` / semantic utility). No hex, `rgb()/hsl()/oklch()`, and no chrome-register tokens (`--mc-chrome-*`) on canvas surfaces — the `canvas-ink-purity` fitness test scans `src/lib/settings` and `src/lib/components`; the new `src/lib/account` must obey the same rules (Task 8 extends the scan to it).
- **Full names — no shorthand.** Spell names out (`account-sections`, not `acct`). Universal externals (`id`, `URL`) excepted.
- **Title Case** for user-facing setting/page/section names ("Account", "Profile", "Two-Factor", "Active Sessions"); descriptions stay sentence case.
- **Honest-seam device.** No control pretends to work: each row renders a disabled control carrying a `<Badge variant="neutral">Soon</Badge>`. The only forward-looking prose allowed is the real schedule seam ("arrives with authentication") — permitted by golden rule 13's forward-reference exception; no ADR/spec/phase citations in source, tests, or user-facing strings.
- **Verification per task — exact commands (verified against this repo):**
  - Tests: from `apps/web/`, `pnpm exec vp test test/<file>.test.ts` for one file, or `pnpm exec vp test` for the whole web project. (There is no `vitest` binary in `apps/web` and no `test` npm script — `vp test` orchestrates the node vitest project.)
  - Format: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint <changed paths>`.
  - Typecheck (svelte-check + tsc): `pnpm --filter @magna-carta/web check`.
  - Full gate: `pnpm check` at the repo root.
- **Working model (UI stream):** subagents implement with strict file ownership and **do not commit**; the coordinator runs the browser verification (one shared Playwright browser) and owns every commit. In this plan the "Commit" steps are **coordinator actions**. See `docs/conventions/ui-design.md`.

---

## Rework note (2026-07-10, mid-execution)

After Tasks 1–6 were built, the owner reshaped the surface: Account Settings is now a **standalone,
walled-off surface** rendered in a reusable **Secure Shell** (a stripped chrome band — brand mark →
Home, Close ✕ / Escape → the previous screen — with no app sidebar or top-bar tools), not a page
inside the `(app)` shell. The route moved from `(app)/account/` to a top-level `account/`; a new
`lib/components/secure-shell.svelte` was added; `account/+layout.svelte` now renders the account rail
into it; and the profile-menu item navigates (same window) to `/account`. The firm-user
administration surface is a deferred sibling that will reuse the Secure Shell. The design spec
(`2026-07-10-account-settings-surface-design.md`) is authoritative for the as-built structure; the
task bodies below describe the earlier `(app)`-nested shape and are kept for history.

---

### Task 1: Account section registry

**Files:**

- Create: `apps/web/src/lib/account/account-sections.ts`
- Test: `apps/web/test/account-sections.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface AccountSection { readonly id: string; readonly label: string; readonly href: string }`
  - `const ACCOUNT_SECTIONS: readonly AccountSection[]` — canonical order: Profile, then Security.
  - `function accountSections(): readonly AccountSection[]` — the rail's render list (canonical order).
  - `function isCurrentAccountSection(section: AccountSection, pathname: string): boolean` — true when `pathname` is the section href or nested under it.
  - `const ACCOUNT_BAND_LABEL = "Account"` — the single band header label.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/account-sections.test.ts
/*
 * Well-formedness of the account nav registry — the account analogue of the settings
 * mode-purity check: pure data, node, no browser. Guards that the rail always renders a
 * consistent, collision-free set of sections whose hrefs match their routes.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SECTIONS,
  accountSections,
  isCurrentAccountSection,
} from "../src/lib/account/account-sections.ts";

describe("account section registry", () => {
  it("lists Profile then Security in canonical order", () => {
    expect(accountSections().map((section) => section.id)).toEqual(["profile", "security"]);
  });

  it("gives every section a unique id", () => {
    const ids = ACCOUNT_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every section a unique href under /account", () => {
    const hrefs = ACCOUNT_SECTIONS.map((section) => section.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/account/")).toBe(true);
  });

  it("derives each href from its id", () => {
    for (const section of ACCOUNT_SECTIONS) {
      expect(section.href).toBe(`/account/${section.id}`);
    }
  });

  it("marks the active section by exact path and by nested path", () => {
    const profile = ACCOUNT_SECTIONS[0];
    expect(isCurrentAccountSection(profile, "/account/profile")).toBe(true);
    expect(isCurrentAccountSection(profile, "/account/profile/anything")).toBe(true);
    expect(isCurrentAccountSection(profile, "/account/security")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `pnpm exec vp test test/account-sections.test.ts`
Expected: FAIL — cannot resolve `../src/lib/account/account-sections.ts`.

- [ ] **Step 3: Write the registry**

```ts
// apps/web/src/lib/account/account-sections.ts
/*
 * The account section registry — data, not markup, mirroring the settings section registry
 * (src/lib/settings/settings-sections.ts): the account rail renders from one canonical list
 * instead of hand-edited links. Account Settings is the member's OWN identity and credentials
 * surface (reached from the profile menu), kept separate from /settings, which carries work and
 * firm preferences. Every section here is the member's own, so the rail shows a single "Account"
 * band — unlike settings, which bands by ownership across member / firm / platform.
 */

export interface AccountSection {
  /** URL segment and stable id, e.g. "profile" -> /account/profile. */
  readonly id: string;
  /** User-facing rail label — Title Case. */
  readonly label: string;
  /** The section's route. Always /account/{id}. */
  readonly href: string;
}

/** The single band header for the account rail (every section is the member's own). */
export const ACCOUNT_BAND_LABEL = "Account";

export const ACCOUNT_SECTIONS: readonly AccountSection[] = [
  { id: "profile", label: "Profile", href: "/account/profile" },
  { id: "security", label: "Security", href: "/account/security" },
];

/** The rail's render list, canonical order. */
export function accountSections(): readonly AccountSection[] {
  return ACCOUNT_SECTIONS;
}

/** True when `pathname` lives under the section (drives aria-current / the active accent). */
export function isCurrentAccountSection(section: AccountSection, pathname: string): boolean {
  return pathname === section.href || pathname.startsWith(`${section.href}/`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `pnpm exec vp test test/account-sections.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Format + typecheck**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint src/lib/account/account-sections.ts test/account-sections.test.ts` then `pnpm --filter @magna-carta/web check`
Expected: no errors.

- [ ] **Step 6: Commit** (coordinator)

```bash
git add apps/web/src/lib/account/account-sections.ts apps/web/test/account-sections.test.ts
git commit -F - <<'EOF'
feat(account): the account section registry

One canonical list the account rail renders from, kept separate from the
settings registry. Profile and Security, each /account/{id}.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Lean account masthead

**Files:**

- Create: `apps/web/src/lib/account/components/account-masthead.svelte`

**Interfaces:**

- Consumes: `@magna-carta/design-system/masthead` (`Masthead.Root`, `Masthead.Heading`, `Masthead.Title`, `Masthead.Meta`).
- Produces: default component with props `{ title: string; meta: string }`.

This is a Svelte component; the node vitest pool cannot render it, so its verification is svelte-check (Step 2) plus the browser pass once a page uses it (Tasks 4–5). No unit test.

- [ ] **Step 1: Write the component**

```svelte
<!-- apps/web/src/lib/account/components/account-masthead.svelte -->
<script lang="ts">
  /*
   * The account page header — INFORMATION ONLY, mirroring the settings masthead's top story but
   * lean: title + one-line descriptor, nothing else. It deliberately omits the settings
   * masthead's posture badge, documentation seam, and history ledger — those speak a settings
   * vocabulary ("Applies on save", a section's registry) that a credential surface does not
   * have. Same design-system Masthead primitives, so the visual voice is identical.
   *
   * Pinned by structure, not sticky: the account content column is a flex stack (header /
   * scrolling middle), so this band sits above the scroll area and carries the column's own
   * top/inline padding, letting the scroll area beneath reach the true canvas edges.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";

  let { title, meta }: { title: string; meta: string } = $props();
</script>

<div class="border-b border-border-strong px-24 pt-24 pb-12">
  <Masthead.Root>
    <Masthead.Heading>
      <Masthead.Title>{title}</Masthead.Title>
    </Masthead.Heading>
  </Masthead.Root>
  <Masthead.Meta class="mt-4">
    <span>{meta}</span>
  </Masthead.Meta>
</div>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint src/lib/account/components/account-masthead.svelte` then `pnpm --filter @magna-carta/web check`
Expected: no errors (svelte-check resolves the Masthead parts and props).

- [ ] **Step 3: Commit** (coordinator)

```bash
git add apps/web/src/lib/account/components/account-masthead.svelte
git commit -F - <<'EOF'
feat(account): a lean masthead for the account surface

Title + descriptor on the shared Masthead primitives — the settings
masthead's information story without its settings-specific posture badge,
documentation seam, or history ledger.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Account shell layout + root redirect

**Files:**

- Create: `apps/web/src/routes/(app)/account/+layout.svelte`
- Create: `apps/web/src/routes/(app)/account/+page.ts`
- Test: `apps/web/test/account-redirect.test.ts`

**Interfaces:**

- Consumes: `accountSections`, `isCurrentAccountSection`, `ACCOUNT_BAND_LABEL` (Task 1); `page` from `$app/state`.
- Produces: the two-column shell (rail + `{@render children()}`); bare `/account` redirects (307) to `/account/profile`.

- [ ] **Step 1: Write the failing redirect test**

```ts
// apps/web/test/account-redirect.test.ts
/*
 * Bare /account lands on the first section rather than a 404 — mirroring /settings, which
 * redirects to its first section. Pure node: the load throws a SvelteKit redirect object.
 */
import { describe, expect, it } from "vitest";
import { load } from "../src/routes/(app)/account/+page.ts";

describe("/account root", () => {
  it("redirects to /account/profile", () => {
    try {
      load();
      expect.unreachable("load should redirect");
    } catch (thrown) {
      const redirectLike = thrown as { status?: number; location?: string };
      expect(redirectLike.status).toBe(307);
      expect(redirectLike.location).toBe("/account/profile");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `pnpm exec vp test test/account-redirect.test.ts`
Expected: FAIL — cannot resolve the `+page.ts` module.

- [ ] **Step 3: Write the root redirect**

```ts
// apps/web/src/routes/(app)/account/+page.ts
/* /account lands on the first section in the rail's canonical order (Profile) rather than a
   404 — an account index page arrives if one ever earns its keep. Mirrors /settings. */
import { redirect } from "@sveltejs/kit";

export function load(): never {
  redirect(307, "/account/profile");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `pnpm exec vp test test/account-redirect.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the shell layout**

```svelte
<!-- apps/web/src/routes/(app)/account/+layout.svelte -->
<script lang="ts">
  /*
   * The account shell — a two-column arrangement inside the work canvas, mirroring the settings
   * shell (src/http/routes/(app)/settings/+layout.svelte): a section rail on the left rendered from
   * the account section registry (one canonical list, so adding a section is a registry entry +
   * a page, never a nav edit), and the active section's page on the right.
   *
   * A SINGLE band — "Account" beside a person glyph on one hairline — because every section here
   * is the member's own. (Settings bands by ownership across member / firm / platform; this
   * surface has one owner, so one band.) The glyph is a plain symbolic Lucide icon, never an
   * avatar or brand mark — identity marks stay in the chrome, the nav carries symbols.
   *
   * Each page keeps its own masthead: the heading belongs to the content, the rail stays a
   * finding aid. Canvas voice throughout — standard tokens, no chrome-* register.
   */
  import { page } from "$app/state";
  import UserRound from "@lucide/svelte/icons/user-round";
  import {
    ACCOUNT_BAND_LABEL,
    accountSections,
    isCurrentAccountSection,
  } from "$lib/account/account-sections.ts";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const sections = accountSections();
</script>

<!--
  TWO INDEPENDENT SCROLL COLUMNS, mirroring the settings shell: the rail and the content each
  scroll on their own, and the canvas itself never scrolls on account routes. The columns reach
  the canvas's TRUE edges — the -m-24 swallows the canvas's own padding and the breathing room
  moves INSIDE each scroll area, so scrollbars sit at the actual edges. The content column is a
  flex STACK (header / scrolling middle) so the page's masthead pins above its own scroll area.
-->
<div class="-m-24 flex items-start" style="block-size: calc(100dvh - var(--mc-size-top-bar))">
  <nav
    aria-label="Account sections"
    class="mc-scrollbar flex h-full shrink-0 flex-col gap-32 overflow-y-auto p-24"
    style="inline-size: calc(var(--mc-size-popover) + var(--mc-space-48))"
  >
    <div class="flex flex-col gap-16">
      <!-- The band header: one hairline, a plain person glyph in muted ink beside the small-caps
           label — never an avatar or brand mark here. -->
      <div class="flex items-center gap-8 border-b border-border-strong px-12 pb-8">
        <UserRound class="size-16 text-text-muted" aria-hidden="true" />
        <p
          class="text-xs font-semibold text-text-default uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {ACCOUNT_BAND_LABEL}
        </p>
      </div>

      <!-- Page rows: control-sized rounded rows, the canvas cousin of the sidebar's menu buttons.
           Hover is a quiet surface tint; the active row carries the gilt start-edge bar as an
           inset shadow (a border would bend around the rounded corners) plus a selected fill and
           firmer text — the same device the settings rail uses. -->
      <ul class="flex flex-col gap-4" style="padding-inline-start: var(--mc-space-24)">
        {#each sections as section (section.id)}
          {@const current = isCurrentAccountSection(section, page.url.pathname)}
          <li>
            <a
              href={section.href}
              aria-current={current ? "page" : undefined}
              class="flex items-center gap-8 rounded-md px-12 text-sm transition-colors duration-fast ease-standard {current
                ? 'bg-surface-selected font-medium text-text-default'
                : 'text-text-muted hover:bg-surface-raised hover:text-text-default'}"
              style="min-block-size: var(--mc-control-sm);{current
                ? ' box-shadow: inset var(--mc-focus-ring-width) var(--mc-space-0) var(--mc-space-0) var(--mc-space-0) var(--mc-accent-default);'
                : ''}"
            >
              {section.label}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </nav>

  <div class="flex h-full min-w-0 grow flex-col">
    {@render children()}
  </div>
</div>
```

- [ ] **Step 6: Format + typecheck**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint "src/http/routes/(app)/account/+layout.svelte" "src/http/routes/(app)/account/+page.ts" test/account-redirect.test.ts` then `pnpm --filter @magna-carta/web check`
Expected: no errors.

- [ ] **Step 7: Commit** (coordinator)

```bash
git add "apps/web/src/routes/(app)/account/+layout.svelte" "apps/web/src/routes/(app)/account/+page.ts" apps/web/test/account-redirect.test.ts
git commit -F - <<'EOF'
feat(account): the account shell and root redirect

A two-column rail + content shell mirroring the settings shell, a single
Account band sourced from the registry; bare /account redirects to the
first section.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Profile section page

**Files:**

- Create: `apps/web/src/routes/(app)/account/profile/+page.svelte`

**Interfaces:**

- Consumes: `AccountMasthead` (Task 2); `SettingsPlate`, `SettingsRow` from `$lib/settings/components/*`; `SettingDefinition` type; design-system `Input`, `Button`, `Badge`, `Avatar`.
- Produces: the `/account/profile` route.

The row seams use page-local `SettingDefinition` objects (the established pattern — the settings Text page does the same). The `control` snippet carries a disabled control + `Soon`; `SettingsRow` supplies the shared grid, label, and description. Keep each control's opening tag on one line (the seam-guard scan in Task 6 checks each interactive tag carries `disabled`).

- [ ] **Step 1: Write the page**

```svelte
<!-- apps/web/src/routes/(app)/account/profile/+page.svelte -->
<script lang="ts">
  /*
   * Account · Profile — the member's identity within Magna Carta. Every row is an honest Soon
   * seam: profile identity is a person-scoped credential surface, and none of it can function
   * before authentication ships a member profile. Each row swaps its seam for a live control
   * when that arrives; until then the disabled control + Soon badge states the coming choice
   * without faking a value. The seam device (disabled control + Soon) is the same one the
   * settings Text and Beta Access pages use.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // Page-local seam definitions: rendering through SettingsRow keeps the shared table grid. The
  // kind/defaultValue fields are inert here (the control snippet renders instead), set to honest
  // neutral values.
  const NAME_DEFINITION: SettingDefinition = {
    id: "account.profile.name",
    sectionId: "account-profile",
    label: "Name",
    description: "The name shown across Magna Carta.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const EMAIL_DEFINITION: SettingDefinition = {
    id: "account.profile.email",
    sectionId: "account-profile",
    label: "Email",
    description: "The address you sign in with and receive notices at.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const AVATAR_DEFINITION: SettingDefinition = {
    id: "account.profile.avatar",
    sectionId: "account-profile",
    label: "Avatar",
    description: "The picture that represents you to your firm.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Profile · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Profile" meta="Your identity within Magna Carta." />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Identity">
      <SettingsRow definition={NAME_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Input disabled placeholder="—" aria-label="Name (arrives with authentication)" />
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={EMAIL_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Input disabled placeholder="—" aria-label="Email (arrives with authentication)" />
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={AVATAR_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Avatar.Root>
            <Avatar.Fallback>MC</Avatar.Fallback>
          </Avatar.Root>
          <Button variant="secondary" disabled aria-label="Change avatar (arrives with authentication)">Change…</Button>
        {/snippet}
      </SettingsRow>
    </SettingsPlate>
  </div>
</div>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint "src/http/routes/(app)/account/profile/+page.svelte"` then `pnpm --filter @magna-carta/web check`
Expected: no errors. (`Button`'s `ButtonVariant` union is `"primary" | "accent" | "secondary" | "destructive" | "ghost"` — `"secondary"` is valid.)

- [ ] **Step 3: Commit** (coordinator; browser verification happens in Task 7)

```bash
git add "apps/web/src/routes/(app)/account/profile/+page.svelte"
git commit -F - <<'EOF'
feat(account): the Profile section, honest seams

Name, Email, and Avatar as Soon seams under an Identity plate — profile
identity arrives with authentication.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Security section page

**Files:**

- Create: `apps/web/src/routes/(app)/account/security/+page.svelte`

**Interfaces:**

- Consumes: `AccountMasthead`; `SettingsPlate`, `SettingsRow`, `SettingDefinition`; design-system `Button`, `Switch`, `Badge`.
- Produces: the `/account/security` route.

- [ ] **Step 1: Write the page**

```svelte
<!-- apps/web/src/routes/(app)/account/security/+page.svelte -->
<script lang="ts">
  /*
   * Account · Security — how the member signs in and protects their account: password,
   * two-factor, active sessions. The higher-ceremony half of the account surface — step-up
   * re-authentication lands here when authentication ships. Every row is an honest Soon seam
   * until then (a disabled control + the Soon badge), never a faked state.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Switch from "@magna-carta/design-system/switch";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  const PASSWORD_DEFINITION: SettingDefinition = {
    id: "account.security.password",
    sectionId: "account-security",
    label: "Password",
    description: "The password you sign in with.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const TWO_FACTOR_DEFINITION: SettingDefinition = {
    id: "account.security.two-factor",
    sectionId: "account-security",
    label: "Two-Factor",
    description: "A second step at sign-in beyond your password.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };

  const SESSIONS_DEFINITION: SettingDefinition = {
    id: "account.security.sessions",
    sectionId: "account-security",
    label: "Active Sessions",
    description: "The devices currently signed in to your account.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Security · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Security" meta="How you sign in and protect your account." />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Sign-In">
      <SettingsRow definition={PASSWORD_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Button variant="secondary" disabled aria-label="Change password (arrives with authentication)">Change…</Button>
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={TWO_FACTOR_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Switch disabled aria-label="Two-Factor (arrives with authentication)" />
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={SESSIONS_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Button variant="secondary" disabled aria-label="Manage sessions (arrives with authentication)">Manage…</Button>
        {/snippet}
      </SettingsRow>
    </SettingsPlate>
  </div>
</div>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint "src/http/routes/(app)/account/security/+page.svelte"` then `pnpm --filter @magna-carta/web check`
Expected: no errors.

- [ ] **Step 3: Commit** (coordinator)

```bash
git add "apps/web/src/routes/(app)/account/security/+page.svelte"
git commit -F - <<'EOF'
feat(account): the Security section, honest seams

Password, Two-Factor, and Active Sessions as Soon seams — the
higher-ceremony half where step-up re-auth lands with authentication.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 6: Seam-guard fitness test

**Files:**

- Test: `apps/web/test/account-seams.test.ts`

**Interfaces:**

- Consumes: the two account page files on disk.
- Produces: a permanent guard that every account row stays an honest seam (no live-write posture, every interactive control disabled, a `Soon` badge present) until a deliberate change.

Because the node pool cannot render Svelte, this is a source scan — the same technique as `canvas-ink-purity.test.ts`.

- [ ] **Step 1: Write the test**

```ts
// apps/web/test/account-seams.test.ts
/*
 * The account honest-seam guard — the CI teeth behind "no account control functions before
 * authentication". A source scan (the node pool cannot render Svelte, so this mirrors the
 * canvas-ink-purity fitness check): every interactive control on an account page must be
 * disabled, no SettingsRow may take a live-write posture (a draft/instant prop), and each page
 * must carry the Soon badge. A real control landing here fails this test until someone updates
 * it deliberately.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGES = [
  "src/http/routes/(app)/account/profile/+page.svelte",
  "src/http/routes/(app)/account/security/+page.svelte",
];

function read(relativePath: string): string {
  return readFileSync(join(import.meta.dirname, "..", relativePath), "utf-8");
}

// Opening tags of interactive design-system controls, captured up to the first ">".
const CONTROL_TAG = /<(Input|Switch|Select\.Root|Button)\b[^>]*>/g;

describe("account honest-seam guard", () => {
  it("disables every interactive control on every account page", () => {
    const offenders: string[] = [];
    for (const relativePath of PAGES) {
      const source = read(relativePath);
      for (const match of source.matchAll(CONTROL_TAG)) {
        if (!/\bdisabled\b/.test(match[0])) {
          offenders.push(`${relativePath} — ${match[0]}`);
        }
      }
    }
    expect(offenders, `enabled controls break the pre-auth seam:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("takes no live-write posture on any SettingsRow", () => {
    const offenders: string[] = [];
    for (const relativePath of PAGES) {
      const source = read(relativePath);
      // draft= / instant= are the SettingsRow posture props that bind a live value.
      if (/<SettingsRow[^>]*\b(draft|instant)=/.test(source)) offenders.push(relativePath);
    }
    expect(
      offenders,
      `account rows must stay seams (no draft/instant posture):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("carries the Soon badge on every account page", () => {
    for (const relativePath of PAGES) {
      expect(read(relativePath), `${relativePath} has no Soon seam`).toContain(
        '<Badge variant="neutral">Soon</Badge>',
      );
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run (from `apps/web/`): `pnpm exec vp test test/account-seams.test.ts`
Expected: PASS (3 tests) — the Task 4/5 pages satisfy every clause. If it fails, the page (not the test) is wrong: fix the page to restore the seam.

- [ ] **Step 3: Format + full web test run**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint test/account-seams.test.ts` then, from `apps/web/`, `pnpm exec vp test`
Expected: the whole web project passes.

- [ ] **Step 4: Commit** (coordinator)

```bash
git add apps/web/test/account-seams.test.ts
git commit -F - <<'EOF'
test(account): honest-seam guard for the account pages

A source scan asserting every account control is disabled, no row takes a
live-write posture, and each page carries the Soon badge — so a real
control cannot land before authentication without a deliberate change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 7: Make the profile-menu item live + browser verification

**Files:**

- Modify: `apps/web/src/lib/components/profile-menu.svelte` (the "Account Settings" `DropdownMenu.Item`)

**Interfaces:**

- Consumes: `goto` from `$app/navigation` (or an anchor navigation consistent with the menu's other items).
- Produces: selecting "Account Settings" navigates to `/account`; its `Soon` badge is removed.

The current item is `disabled` with a trailing `<Badge variant="neutral" class="ms-auto">Soon</Badge>`. The design-system menu `Item` keeps Bits' element delegation closed (see the ecosystem-site handling in the same file: it navigates programmatically rather than rendering an anchor), so navigate on select the same way.

- [ ] **Step 1: Read the current item**

Read `apps/web/src/lib/components/profile-menu.svelte` lines ~52–67 (the Account Settings `DropdownMenu.Item`).

- [ ] **Step 2: Add the navigation import**

At the top of the `<script>`, add:

```ts
import { goto } from "$app/navigation";
```

- [ ] **Step 3: Replace the disabled item with a live one**

Replace the `<DropdownMenu.Item disabled>…Account Settings…Soon…</DropdownMenu.Item>` block with:

```svelte
    <!-- Account Settings — the member's own identity and credentials surface (2FA, password,
         profile), a higher-ceremony surface than preference settings: step-up re-authentication
         lives there when authentication ships, so it hangs off the profile, not the settings
         nav. The controls inside are honest Soon seams until authentication ships; the door is
         live now so the surface and its flow exist. (Shield, not ShieldCheck — the check variant
         is the Trust Center website's icon.) -->
    <DropdownMenu.Item onSelect={() => goto("/account")}>
      <Shield class="size-16" aria-hidden="true" />
      <span class="flex min-w-0 flex-col">
        <span>Account Settings</span>
        <span class="text-xs">2FA, password, and profile</span>
      </span>
    </DropdownMenu.Item>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint src/lib/components/profile-menu.svelte` then `pnpm --filter @magna-carta/web check`
Expected: no errors.

- [ ] **Step 5: Browser verification** (coordinator, shared Playwright browser)

Start the dev server from `apps/web` (`pnpm exec vp dev`), then in one browser session:

1. Open the app, click the profile avatar (top-right) → the menu opens; "Account Settings" is enabled with no Soon badge.
2. Select it → lands on `/account/profile`; the Account rail shows Profile (active, gilt edge) and Security.
3. Confirm the Profile plate shows Name, Email, Avatar rows, each with a disabled control + Soon.
4. Click Security → `/account/security` renders Password, Two-Factor, Active Sessions seams; the rail's active row moves to Security.
5. Visit `/account` directly → redirects to `/account/profile`.
6. Toggle dark mode → rail, masthead, plates, and seams all recolor through tokens (no pinned-mode ink).

Capture a screenshot of each section for the record. Expected: all steps pass.

- [ ] **Step 6: Commit** (coordinator)

```bash
git add apps/web/src/lib/components/profile-menu.svelte
git commit -F - <<'EOF'
feat(account): open Account Settings from the profile menu

The profile-menu item becomes a live door into /account; its Soon badge
drops. The controls inside remain honest seams until authentication.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 8: Extend the ink-purity scan + documentation

**Files:**

- Modify: `apps/web/test/canvas-ink-purity.test.ts` (add `src/lib/account` to `SCAN_ROOTS`)
- Modify: `docs/conventions/settings.md` (one cross-reference line)
- Create: `changelog.d/account-settings-surface.md`

**Interfaces:** none.

- [ ] **Step 1: Extend the ink-purity scan roots**

In `apps/web/test/canvas-ink-purity.test.ts`, add the account library to `SCAN_ROOTS`:

```ts
const SCAN_ROOTS = [
  join(import.meta.dirname, "../src/lib/settings"),
  join(import.meta.dirname, "../src/lib/account"),
  join(import.meta.dirname, "../src/lib/components"),
];
```

(The account page routes carry only tokenized utilities from this plan; the scan already covers `src/lib/components`. Adding `src/lib/account` guards the masthead and any future account components.)

- [ ] **Step 2: Run the ink-purity scan**

Run (from `apps/web/`): `pnpm exec vp test test/canvas-ink-purity.test.ts`
Expected: PASS — the account masthead uses only semantic utilities.

- [ ] **Step 3: Add the settings-convention cross-reference**

In `docs/conventions/settings.md`, under the `## Scope` sentence, add one line:

```markdown
**Sibling surface:** person-scoped identity and credentials (profile, password, two-factor, sessions) live in the separate **Account Settings** surface (`/account`, reached from the profile menu), not in this registry — a work preference is different from an account setting. See the account section registry (`apps/web/src/lib/account/account-sections.ts`).
```

- [ ] **Step 4: Write the changelog fragment**

```markdown
<!-- changelog.d/account-settings-surface.md -->

### Added

- **Account Settings surface.** A person-scoped identity and credentials surface at `/account`,
  reached from the profile menu — Profile (name, email, avatar) and Security (password,
  two-factor, active sessions). Every control is an honest seam today; the surface, its rail, and
  the profile-menu flow are live, and each control activates when authentication ships.
```

- [ ] **Step 5: Format + full gate**

Run: `pnpm --filter @magna-carta/web exec vp check --fix --no-lint test/canvas-ink-purity.test.ts`, then from `apps/web/` `pnpm exec vp test`, then from the repo root `pnpm check`
Expected: the full quality gate and the web test project pass.

- [ ] **Step 6: Commit** (coordinator)

```bash
git add apps/web/test/canvas-ink-purity.test.ts docs/conventions/settings.md changelog.d/account-settings-surface.md
git commit -F - <<'EOF'
docs(account): note the sibling surface, log the change, guard the ink

Cross-reference Account Settings from the settings convention, add the
changelog fragment, and extend the canvas ink-purity scan to src/lib/account.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage:**

- New `/account` surface mirroring the settings shell → Task 3 (layout) + Task 1 (registry).
- Profile and Security sections, one route each → Tasks 4, 5.
- Honest Soon seams on every control → Tasks 4, 5; enforced by Task 6.
- Profile-menu item becomes a live link, Soon badge dropped → Task 7.
- Reuse `SettingsPlate` + `SettingsRow` unchanged → Tasks 4, 5.
- New `account-sections.ts`, `account/+layout.svelte`, lean `account-masthead.svelte` → Tasks 1, 3, 2.
- Root `/account` redirect → Task 3.
- Registry well-formedness + seam guard + root redirect tests → Tasks 1, 6, 3.
- Changelog fragment + settings-convention cross-reference + active-work note (already committed) → Task 8.
- Out of scope (real credentials/sessions/sign-out/step-up) → not built; seams name what they wait for.

**Placeholder scan:** no TBD/TODO; every code step carries complete code; the one conditional ("if `variant="secondary"` is rejected, use a valid variant") points to the exact package to read rather than leaving a blank.

**Type consistency:** `AccountSection` fields (`id`/`label`/`href`) are used identically in Tasks 1 and 3; `accountSections()`/`isCurrentAccountSection()`/`ACCOUNT_BAND_LABEL` names match between definition (Task 1) and consumption (Task 3); `AccountMasthead` props `{title, meta}` match between definition (Task 2) and use (Tasks 4, 5); `SettingDefinition` fields match the real type read from `settings-definitions.ts`; `Button variant="secondary"` is a member of the real `ButtonVariant` union (verified).
