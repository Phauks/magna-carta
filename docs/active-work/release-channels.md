# Active work — release-channels

**Stream:** Release channels (stable / beta / alpha) — firm-level opt-in to pre-release behavior, gated by Cloudflare Flagship behind an OpenFeature-shaped port.

**Branch:** `release-channels` (worktree `C:/dev/magna-carta-worktrees/release-channels`), off `main`.

**Status:** Design. Spec at `docs/specs/2026-06-25-release-channels-design.md`. Not yet planned or built.

## Scope / files expected to touch

- `packages/database/src/control-plane-schema.ts` — add `firm.release_channel` column (+ generated control-plane migration).
- `packages/feature-flags/` — NEW package: OpenFeature-shaped port + Flagship adapter + in-house D1 fallback adapter (seam).
- `packages/access-control/src/registry.ts` — add `firm:manageReleaseChannel` permission.
- `apps/worker/` — beta firm-setting door (DAL + route), alpha secret-guarded platform door, `/me` resolved-flag delivery, `env.FLAGS` binding in `wrangler.jsonc`, session-context channel read.
- Settings registry entry for the beta opt-in (audited + consent-gated).
- Docs: white-paper *Release channels* topic, ADR fragment(s), user help for beta opt-in, ROADMAP/CHANGELOG fragment.

## Notes

- Channels gate **behavior only** — never backend code-path existence, never schema. Schema stays the single additive fleet union; feature code ships dark to all firms.
- Cross-cutting files (CLAUDE.md, STATUS.md, ROADMAP.md, white paper, conventions): run `vp run worktrees` and sync `main` before editing.
