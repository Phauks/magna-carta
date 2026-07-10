# Slice 0·7b, stage 1 — the real App Shell (design)

**Status:** in build 2026-07-02 (UI stream). Executes stage 1 of the UI roadmap
([`ROADMAP.md`](../../ROADMAP.md), "UI roadmap"); the shell's structure and canonical navigation
are the owner-approved decisions in
[`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md) — this document adds only the
execution decisions that turn the archetype into routes and code. The other two stage-1 items
(auth UI, appearance settings) follow in this slice; **the sign-in screen's visual design gets
its own owner lab pass before build** (a ceremonial edge is never inferred).

## Scope

The assembled App Shell as real routes in `apps/web`: the chrome (sidebar + top bar) framing a
routed work canvas, the data-driven navigation registry, and stub destination pages that light up
as their UI ships. No backend dependency; auth gating is a seam.

## Decisions

1. **Composition boundary (from the architecture audit, 2026-07-02).** The design system owns the
   chrome _parts_ — `Sidebar.*`, `BrandMark`, and a new **`TopBar`** family (`Root` / `Search` /
   `Actions`), since chrome is identity and the future portal/Tauri shells re-consume it. The app
   owns the _assembly_: `AppShell` composes the parts, and the navigation registry + permission
   filtering live app-side because roles and module flags are domain knowledge that must never
   enter the design system.
2. **The navigation registry is data** (`apps/web/src/lib/navigation/destinations.ts`): the FULL
   canonical order from the archetypes doc (every destination, including unshipped phases), each
   entry carrying `group`, `icon`, `href`, and `shipped`. The sidebar renders only shipped
   destinations, hide-in-place; permission filtering (slice 0·4 effective permissions) and firm
   module flags attach to the same entries when auth lands — the registry shape is the seam.
   **Light-up rule: a destination ships when its UI ships**, not its backend — the sidebar is a
   promise to the user, not an inventory of the codebase.
3. **Routes are the archetype map:** `/` (Home dashboard), one route per destination
   (`/matters`, `/settings/appearance`, …), matters deep links reserved as `/matters/[id]`
   (real-URL rule, archetypes §1.3). `+error.svelte` implements the state-set error pattern
   (recoverable message + the user-facing Error ID slot).
4. **Top-bar seams stay seams:** the command palette trigger opens the DS `Command` dialog (the
   provider registry starts with navigation; matters join in stage 2); `+New`, the billable
   timer, and alerts render their reserved slots as disabled/hidden affordances until their
   slices land — the shell reserves geometry, never fakes function.
5. **Tools joins the canonical registry** under **Firm** (Tools · Communications · Reports) — the
   left-nav destination ADR-0101 already assigns; recorded as a dated addition in the archetypes
   doc.
6. **Unauthenticated behavior (interim):** the shell renders without a session until the auth UI
   lands later in this slice; the layout carries the guard seam (`requireSession` stub) so
   flipping it on is one change.

## Testing

Shell behavior is covered by the design-system story suite (Sidebar/App-Shell/Masthead already
test collapse, landmarks, axe); the app adds route smoke via the existing Miniflare worker
integration test path once auth lands. Visual verification per state (empty Home, stub pages)
happens in the running app during the owner review.
