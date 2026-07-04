# service-status-ui — the public status page (frontend)

**Stream:** UI (Fable), parallel to `slice-0-7b-app-shell` (the app shell / settings stream —
same coordinator, disjoint files).

**Scope:** the user-facing status page served by the isolated status worker. The backend —
`apps/status-worker`, exception-based health, the two-writer KV contract, the
`platform_operator` axis — is already on `main`
([`docs/specs/2026-07-02-service-status-design.md`](../specs/2026-07-02-service-status-design.md));
this stream researches the status-page genre, mocks up two candidate designs for owner
review (static markups, design-lab pattern), then builds the chosen page.

**Files touched:** `status-lab/` (transient mockups at the repo root of this worktree),
then `apps/status-worker/**` (the page it serves) once a direction is chosen. No app-shell
or settings files — those belong to `slice-0-7b-app-shell`.

**Coordination:** backend remains read-only for the UI stream (requirements file to
[`docs/research/fable-backend-review-2026-07.md`](../research/fable-backend-review-2026-07.md));
the status JSON contract is consumed as committed.
