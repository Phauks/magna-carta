# Active work — release-channels

**Stream:** Release channels (stable / beta / alpha) — firm-level opt-in to pre-release behavior, gated by Cloudflare Flagship behind an OpenFeature-shaped port.

**Branch:** `release-channels` (worktree `C:/dev/magna-carta-worktrees/release-channels`), off `main`.

**Status:** Backend rails built (2026-06-25). Plan 2 (frontend opt-in UI + stage-labeled alpha/beta visibility) **deferred until after slice 0.7** (design-system work). Next backend piece: automate control-plane migration application (the deploy precondition below).

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

## Deferred to Plan 2 / before first real client

- **Consent text + version recording.** The beta door currently records only a `consentAcknowledged` boolean in `audit_log`. The design wants the _exact consent statement text and version_ the admin saw recorded for the defensible artifact. Add a `consentVersion` (and the canonical statement text) to the beta request contract + audit metadata when Plan 2 authors the consent dialog, before the first real client firm opts into beta.

## Deploy precondition (backend rails)

- **No manual migration step is required.** The scheduled handler (`apps/worker/src/scheduled.ts`) now applies control-plane migrations automatically — `0003_handy_rattler` will land within one `*/5` cron cycle after the worker deploys. During that brief window, `/me` fail-safes to `channel: "stable"` and the default flag set on any channel-read error, so no session bootstrap fails. An operator who needs the schema applied immediately can wait one cron cycle (at most ~5 minutes) or invoke the scheduled handler manually.
