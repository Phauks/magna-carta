---
worktree: C:/dev/magna-carta-worktrees/claude/date-handling-audit-xx8q3o
area: One home for date handling — the @magna-carta/civil-time package, the design system's date formatters, and the gate that keeps them the only copies
status: review
touches: packages/civil-time, packages/design-system/src/lib/formatters, packages/calendar, packages/notes, packages/tasks, packages/ledger, packages/matters, packages/matter-assets, packages/conflicts, packages/trust, packages/notifications, packages/locations, packages/reporting, packages/directory, packages/document-assembly, packages/custodian, packages/status, packages/fixtures, packages/inference, packages/product-updates, packages/database, packages/wellbeing-resources, apps/api-worker, apps/web, tooling/lint-date-handling, CLAUDE.md, docs/conventions/dates.md, docs/conventions/README.md, package.json, vite.config.ts
---

Consolidates date handling behind two authorities and adds a fitness function that keeps it there.
New leaf package `@magna-carta/civil-time` owns what a civil date, a wall-clock time, a stored
instant and a time zone ARE; the design system's `formatters/` own how each reads. Removes six
implementations of "is this a real calendar day", three of "is this a resolvable zone" (two of which
accepted a fixed offset the third refused), about forty copies of the civil-date pattern, six of the
canonical-instant pattern, six of the date picker's value reader, and nine surfaces that each
printed a moment their own way. `pnpm run lint:date-handling` is the gate.

Touches a very wide set of files but almost all of it is import rewiring. The load-bearing edits are
the new package, `packages/design-system/src/lib/formatters/{civil-date,instant}.ts`, the two
fitness tests whose exemption lists this removes (`packages/calendar/test/window-and-arithmetic.test.ts`,
`packages/tasks/test/no-arithmetic.test.ts`), and `tooling/lint-date-handling/`. A concurrent stream
adding a date field or a date-shaped validator will meet the new gate; the ruling ledger is
`docs/conventions/dates.md`.
