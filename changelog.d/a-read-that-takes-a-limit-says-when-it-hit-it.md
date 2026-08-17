---
category: Changed
audience: internal
---

**A read that takes a limit now says when it hit it, and six feature-ledger nodes stop claiming work
is underway where only a branch or a document is.** Two unrelated defects, one shape: an instrument
that reads healthy while reporting nothing.

**The calendar's zone read returns its own clamp.** `readOpenDeadlineTimeZones` took a `limit` and
returned a bare array, so no caller could tell a complete zone list from one the bound cut short
except by over-reading and comparing. That is not an under-filled page: the zone list is what the
overdue narrowing derives one cutoff per zone from, so a zone the read never returns contributes no
cutoff, and every deadline recorded in it matches neither the overdue bound nor the due-today
window — a whole jurisdiction goes unreported while every counter beside it reads healthy. The read
now over-reads by one itself and answers `{ timeZones, clamped }`, the shape the notification
digest's window read already uses. `clamped` is a boolean on purpose: over-reading by one learns
_that_ the bound bit and never _by how much_, and a magnitude invented there would be the same
dishonesty one level down.

The notification comparison sweep had hand-rolled exactly this at its call site, correctly, and now
consumes the signal instead. Its `notifications.comparison_zone_discovery_truncated` counter is
unchanged in meaning and value — still one per truncated **pass**, charged to both deadline kinds.
The deadline-list route discards the new signal deliberately, and says why: a list read has nowhere
honest to put it, and the nightly pass is where the same truncation is already counted.

**The `in-build` sweep.** `in-build` is the register's most misleading status — it tells a reader
work is actively underway — and `lint:ledger-staleness` structurally cannot catch a wrong one: it
compares a node against its slice's status fragment, and a documentation-only branch produces a
perfectly plausible fragment. So every node at `in-build` was checked against the repository
instead. Six were wrong, in both directions:

- **`documents.file-manager.file-inspector` → `not-started`.** It was `in-build` on a remote branch
  carrying a single documentation commit and no code; there is no inspector route, no inspector
  module, and no design under `docs/specs/`. Not `designed` either — the design is unmerged, so
  there is no accepted spec for that status to point at.
- **`documents.ocr.raster-cap` → `shipped`**, and **`platform.schema-migration.monotonic-ids` →
  `shipped`.** Both pointed at a branch (in the second case at an active-work note that no longer
  exists) while the capability had reached `main` independently, with tests.
- **The docs-maintenance system → `shipped` for per-merge assembly and the run-report registry,
  `partial` for the parent.** All three named artifacts are on `main`, the deterministic assembler
  runs on every push, and the report registry has entries beyond its baseline; the evidence still
  said "unmerged".

**Five nodes were left alone and the reasoning written down** rather than guessed at, because
`partial` and `in-build` mean different things and choosing between them on a hunch is worse than
naming the ambiguity.
