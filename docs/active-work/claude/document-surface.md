# claude/document-surface

**Scope:** The matter Documents surface — the create → edit → save → version loop a person can click
through, standing on the API routes that already exist rather than adding new ones.

## What this stream does

The backend for documents is built and reachable: `files.list`, `files.versions`, the four-step upload
ceremony (`uploads.initiate` → PUT → `uploads.complete` → `uploads.get`), `assemblies.submit` /
`assemblies.status`, and `documents.editSession`. What was missing was the screen. `apps/web`'s matter
Files page rendered fixtures and the matter chrome resolved matters from a fixture list, so a real
seeded matter could not even be reached at its own URL.

This stream builds:

- `apps/web/src/lib/matters/matter-record.ts` — the matter view model the chrome reads, resolved from
  the live API with the in-repo fixtures as the named fallback. A live matter and a sample matter are
  distinguishable (`source`), so no screen has to guess which it is showing.
- `apps/web/src/lib/documents/` — the document surface's logic, out of the components:
  `document-api.ts` (the same-origin fetch seam), `document-presentation.ts` (pure display decisions),
  `create-document.ts` (upload + assemble orchestration), `document-loop-availability.ts` (what the
  environment can actually do).
- The Documents page at `apps/web/src/routes/(app)/matters/[id]/files/` — the real list, both creation
  paths, the version history, and the editor launch.

## What is real and what is not

Real, against live bindings: the list, upload-create, save-a-new-version, the version history, the
assembly submit/poll, and the edit-session launch (a real token, a real audit row, a real `edit_state`
flip).

Not real locally: the Collabora editor itself. The launch response names an origin served by the
`magna-carta-edit` worker's per-document container, which is a Workers-Builds deploy step — it does not
exist on a developer's machine. The surface makes the real call and then says so, rather than rendering
a dead iframe.

## Files expected to be touched

- `apps/web/src/lib/documents/**` (new), `apps/web/src/lib/matters/matter-record.ts` (new)
- `apps/web/src/routes/(app)/matters/[id]/files/+page.svelte`, `+layout.ts`
- `apps/web/src/lib/matters/{fixtures,matter-header}.ts|svelte`,
  `apps/web/src/routes/(app)/matters/[id]/{overview,time,costs}/+page.svelte` — the matter-record type
  swap only
- `apps/web/test/**` — the unit tests for the seams above

**Never edited:** `apps/worker/src/auth.ts` and the login route (`claude/auth-routes` owns those); no
`/api/v1` route is added or changed by this stream, so the contract snapshot and the conformance
operation list are untouched.

## Overlaps

- `docs/active-work/file-surface-web.md` — the abandoned predecessor, read in full and dispositioned
  in a note at the top of that file. Its multi-view shell and persisted-preference primitive already
  landed on `main`; its Matter Files body did not, and is not revived (it is built on an
  `@magna-carta/api-client` + TanStack Query adoption `apps/web` has since gone the other way on).

  **Taken from it anyway, as reasoning rather than code:**
  - _Status is presentation, and the two that need attention are the only ones that wear a chip._
    `document-presentation.ts` keeps that shape, including listing a rejected document with its
    reason rather than letting it vanish — its sharpest single decision.
  - _Sizing off the spacing scale fails silently._ A step that is not a defined token does not error;
    Tailwind falls back to `0.25rem × n`, which is how `min-w-160` became 640px on that branch. The
    editor frame here is sized by aspect ratio for exactly that reason, noted at the call site.
  - _The root of a folder browser lists every document in the matter,_ because the contract cannot
    express "no folder". This surface is deliberately flat for now, so the trap is avoided rather
    than inherited — but it is still true and still unfixed in the contract.
  - The shape of the enriched list row (status, quarantine reason, version number, sniffed type) and
    the four-step upload ceremony's ordering, both confirmed against the current contract.

- Shares `apps/web` with any app-shell work; touches no worker source.
