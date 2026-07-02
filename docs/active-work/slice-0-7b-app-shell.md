# slice-0-7b-app-shell — the real App Shell, auth UI, appearance settings

**Stream:** UI (Fable). Stage 1 of the UI roadmap (ROADMAP.md, "UI roadmap — the
deferred-surface build order"): the assembled App Shell as real routes in `apps/web` (chrome
parts from the design system; nav registry + permission filtering app-side), then the login/2FA
UI over the slice 0·4 backend, then the appearance-settings surface over the wired
theme/mode/density/motion axes.

**Files touched:** `apps/web/**` (routes, shell composition, app.css/app.html already carry the
boot + cascade), `packages/design-system/**` (small part additions as the shell demands — TopBar
parts, register polish), design-lab mockups (untracked working artifacts in this worktree).

**Coordination:** backend is read-only for this stream (UI brief); auth consumes the committed
contract as-is. No cross-cutting edits expected beyond this note, ROADMAP stage updates, and the
STATUS 0·7b row.

**Worktree note:** this directory is the former `slice-0-7a-design-system` worktree, repurposed
after 0·7a merged — the folder name lags the branch (`slice-0-7b-app-shell`).
