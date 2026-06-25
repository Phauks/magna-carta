# Active work — release-channels

**Stream:** Release channels (stable / beta / alpha) — firm-level opt-in to pre-release behavior, gated by Cloudflare Flagship behind an OpenFeature-shaped port.

**Branch:** `release-channels` (worktree `C:/dev/magna-carta-worktrees/release-channels`), off `main`.

**Status:** Backend rails built (2026-06-25). Plan 2 (frontend opt-in UI + stage-labeled alpha/beta visibility) pending.

## Scope / files expected to touch

- `packages/database/src/control-plane-schema.ts` — add `firm.release_channel` column (+ generated control-plane migration).
- `packages/feature-flags/` — NEW package: thin wrapper over the Flagship `env.FLAGS` binding (context-building + safe defaults + test fake).
- `packages/access-control/src/registry.ts` — add `firm:manageReleaseChannel` permission.
- `apps/worker/` — beta firm-setting door (DAL + route), alpha secret-guarded platform door, `/me` resolved-flag delivery, `env.FLAGS` binding in `wrangler.jsonc`, session-context channel read.
- Beta opt-in = a dedicated firm endpoint writing the control-plane channel column (NOT the per-firm scoped-setting registry); Settings UI section is a later frontend slice.
- Docs: white-paper _Release channels_ topic, ADR fragment(s), user help for beta opt-in, ROADMAP/CHANGELOG fragment.

## Notes

- Channels gate **behavior only** — never backend code-path existence, never schema. Schema stays the single additive fleet union; feature code ships dark to all firms.
- Cross-cutting files (CLAUDE.md, STATUS.md, ROADMAP.md, white paper, conventions): run `vp run worktrees` and sync `main` before editing.
