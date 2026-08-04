# libreoffice-engine-build

**Branch:** `claude/libreoffice-engine-build` · **Off:** main (0d72292e) · **Owner:** Trevor Goldsmith · **Started:** 2026-08-04

## Scope

Build the LibreOffice conversion engine to its accepted design
(`docs/specs/2026-08-04-libreoffice-conversion-engine-design.md`): the container, the process pool,
the image, the HTTP contract, and the additive wiring into the existing per-engine dispatch. It gives
bodies to the four office edges the conversion registry has declared for two months
(`docx→pdf`, `odt→pdf`, `docx→odt`, `wpd→odt`) and carves the job-package seam the email-to-PDF render
engine will later occupy.

A Rust supervisor with an axum surface manages long-lived worker child processes, each of which loads
LibreOffice once through the pinned `libreofficekit` binding and converts one document at a time.
Recycling is always process replacement — the binding segfaults if an instance is recreated in place —
and the supervisor holds no suite state, so a wedged conversion kills its own child and nothing else.
The pool's state machine is proved host-side against a fake worker binary, which is where the design
says the risk lives.

Excluded, and left honest rather than silently skipped: the email render engine itself, the
matter-attached save-as-version path, the user interface, any spreadsheet or presentation format, a
real WordPerfect acceptance fixture, and a real wedge fixture.

## Files I expect to touch

- `containers/libreoffice/**` — new: the crate (supervisor, worker, fake worker), the Dockerfile, the
  baked profile, the acceptance suite and its fixtures, `CLAUDE.md`
- `apps/worker/src/conversions/conversion-engine.ts` — `CONVERT_WORKER_ENGINE_IDS` gains the engine id
- `apps/worker/test/conversion-engine.test.ts` — the office engine is no longer deferred
- `apps/convert-worker/src/engine-dispatch.ts` + `test/engine-dispatch.test.ts` — the new target
- `apps/convert-worker/src/libreoffice-engine-container.ts` — new Container class
- `apps/convert-worker/src/index.ts` — binding, re-export, target-to-namespace lookup
- `apps/convert-worker/wrangler.jsonc` — container, binding, migration `v2`
- `.github/workflows/gate.yml` — cache workspace, audited lockfile, acceptance case
- `docs/deploy-queue.md` — the activation steps and their order
- `changelog.d/libreoffice-conversion-engine.md`, `status.d/2-4-in-app-conversion.md`
