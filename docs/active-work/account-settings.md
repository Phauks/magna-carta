# account-settings

**Stream:** Account Settings surface — the person-scoped identity/credentials surface reached from
the profile menu (separate from `/settings`, which carries work + firm preferences).

**Base:** branched off `slice-0-7b-app-shell`.

**Scope:** honest-seam scaffold + the profile-menu → surface flow. No auth wiring (credentials land
with authentication). Mirrors the settings shell structure (persistent left rail + one route per
section), reusing the settings presentational parts.

**Files I expect to touch:**

- `apps/web/src/routes/(app)/account/**` (new: `+layout.svelte`, `profile/+page.svelte`,
  `security/+page.svelte`)
- `apps/web/src/lib/account/**` (new: `account-sections.ts`, `components/account-masthead.svelte`)
- `apps/web/src/lib/components/profile-menu.svelte` (make the Account Settings item a live link)
- `apps/web/test/**` (route smoke + seam guard)
- `docs/specs/2026-07-10-account-settings-surface-*.md`, `changelog.d/`, `docs/conventions/settings.md`
  (one cross-reference line noting the sibling surface)

**Reuses (does not modify):** `settings/components/settings-plate.svelte`,
`settings/components/settings-row.svelte`.
