---
category: Changed
audience: internal
---

**Six questions raised against a file-manager mockup, answered from source. Four of the six already
have a house answer that should be reused; one is a real gap that is cheap now and expensive later;
the data-loss risk the owner flagged is not real, and the reason it is not real is one function.**

The screen is being designed concurrently, so the questions were traced rather than guessed, and
where a thing could not be settled from here the answer says so:
[`docs/research/2026-08-22-file-manager-open-questions.md`](docs/research/2026-08-22-file-manager-open-questions.md).

**Reuse, do not invent — four of the six.** The client error pattern is three built pieces (the
three-outcome `requestJson` seam, `problemGuidance`, and the copyable `error-details.svelte` block)
plus a "Report an Issue" dialog reachable from every screen; what is missing is the boundary and the
wire to the already-built `POST /api/v1/incidents`, not the surface. The mockup's "API gap" chip is
the existing Soon Badge, and there is a standing owner rule requiring exactly that
(`docs/conventions/ui-design.md` — designed-but-unwired ships visible, disabled, marked Soon, with one
line naming what it waits on). Name-based file typing needs no dependency: the conversion registry
already carries display labels per extension, and the design system's `resolveFileCategory` already
drives the file list's glyph. `.doc` and `.docx` are correctly distinguished in every registry that
distinguishes them — the gap is narrower and different, that only the discovery lane can read a
`.doc` at all, and its LibreOffice edge is undeployed.

**The gap worth closing while in the area.** The ingest gate compares the sniffed magic bytes against
the declared type and quarantines a lie as `type-mismatch` — then discards the evidence.
`quarantineVersionStatement` writes only the reason token, and `sniffed_content_type` is never
written on the quarantine path, so a quarantined row keeps the declared type and a NULL sniffed one.
A screen cannot say "this file says A but its bytes say B", and a reviewer opening the row months
later gets the kebab-case string `type-mismatch` rendered verbatim under a red Rejected chip. Storing
both sides is a one-line change at a call site whose own comment argues for it.

**The data-loss risk is not real, and the guard is load-bearing.** Two identically-named files in one
bulk download cannot lose each other: `resolveZipSelection` runs every entry through `disambiguate`,
which suffixes `" (n)"` before the extension over a deterministic sort, on every delivery lane. It
matters that it is there — `client-zip` performs no uniqueness check of its own, so removing it would
write both entries and most extractors would silently keep the second. What is real is the duplicates
themselves: folders have a sibling-name constraint (with two holes — SQLite's NULL-distinctness leaves
the matter root to application code alone, and the comparison is case-sensitive and untrimmed), files
have none at any layer, there is no copy endpoint at all, and two producers mint duplicate names
deterministically — assembling one template onto one matter twice, and expanding an archive whose
entries share a leaf name.

**Left as findings, with evidence rather than a patch:** the plain download lanes disambiguate but
never sanitize archive paths, while the optioned lanes do both in the correct order — worth checking
as a zip-slip question on its own, unverified here; `problemGuidance` already exists as two forked
copies; and the File Type Verifier, which is the product answer to the sniffed-versus-claimed
question, has a sound report builder, an undeployed engine, and no page.
