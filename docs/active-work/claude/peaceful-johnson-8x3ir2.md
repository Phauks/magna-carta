---
worktree: C:/dev/magna-carta-worktrees/claude/peaceful-johnson-8x3ir2
area: Opening a file — one shell for every opened document, and the editor's silent white frame
status: building
touches: containers/collabora, apps/api-worker/src/editing, apps/web/src/lib/documents, apps/web/src/lib/components/app-shell.svelte, apps/web/src/routes/(app), apps/web/src/routes/(document), apps/web/src/lib/navigation/session-guard.ts
---

Opening a `.docx` produced a white rectangle with nothing in the console. The cause is the editor's
own `frame-ancestors`: coolwsd allows only itself and the WOPI host to frame it, the application is
neither, and the refusal is reported inside the framed document where nobody looks. Fixed in the
Collabora image; the same change also stops the screen being able to fail silently again, by having
the editor announce itself over postMessage and reporting its silence when it does not.

Also moves `/documents/[id]/{view,edit}` into a `(document)` route group — the App Shell without its
destination rail, top bar kept — and puts both routes on one shared `DocumentShell`, which always
draws even when the document cannot be opened.

Touches two cross-cutting things a concurrent stream should know about: `app-shell.svelte` gains a
`navigation` prop (default true, so every existing caller is unchanged), and the `(app)` group's
session guard moved out to `$lib/navigation/session-guard.ts` so both groups share one gate.
