---
branch: claude/libreoffice-engine-design
worktree: C:/dev/magna-carta-worktrees/claude-libreoffice-engine-design
area: LibreOffice conversion engine — design cycle only (no engine code)
status: designing
touches: docs/specs/2026-08-04-libreoffice-conversion-engine-design.md, docs/decisions/pending/libreoffice-engine-design.md, status.d/2-4-in-app-conversion.md
---

Writes the design for the LibreOffice conversion engine that fills the four registered office edges
(`docx→pdf`, `odt→pdf`, `docx→odt`, `wpd→odt`, plus the `wpd→odt→pdf` chain): a standalone
network-isolated Container whose supervisor manages a pool of long-lived, single-threaded
LibreOfficeKit worker child processes, bound through the pure-Rust `libreofficekit` crate. Also
carves the job-package seam the email-to-PDF render engine will occupy in a later cycle.

Documentation only. No source, no Dockerfile, no worker wiring — the exact additive entries
(`CONVERT_WORKER_ENGINE_IDS`, `engineTargetFor`, the Container class, the `wrangler.jsonc` container
plus binding plus migration `v2`, the `gate.yml` acceptance case) are specified in the design and
built in the follow-on slice.

Do not step on: `status.d/2-4-in-app-conversion.md` (only its `next:` line changes here), and the
convert-worker files named above — this stream writes none of them, but the follow-on build stream
will own all of them.
