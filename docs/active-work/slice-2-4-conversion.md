---
branch: slice-2-4-conversion
worktree: C:/dev/magna-carta-worktrees/slice-2-4-conversion
area: Slice 2·4 — in-app file conversion — research doc only (design cycle gated on 2·1/2·2 substrate)
status: designing
touches: docs/research/in-app-conversion.md, docs/active-work/slice-2-4-conversion.md
---

Producing the 2·4 conversion **research doc** (`docs/research/in-app-conversion.md`) — design input
only, the `upload-malware-scanning.md` precedent for 2·1. No code, no spec, no ADR yet; the full
2·4 design cycle waits until 2·1's Queue/Container/Durable-Object substrate and 2·2's
LibreOffice-container pattern have settled. Additive new file plus this note — collides with nothing.
Does **not** touch the in-flight scan-engine (2·1), editing (2·2), or safe-delivery (2·3) streams; the
shared execution substrate is *referenced*, not re-decided. Records one reframe of the published
_In-app file conversion_ stance (in-house-only → pluggable engines with confidentiality as the
default) that a later design cycle turns into an ADR + a white-paper amendment.
