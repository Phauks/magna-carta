---
worktree: /home/user/magna-carta (remote session)
area: ActionDialog seams (Enter commits, string subtitle, commitSoon), the maturity family moved into the design system, LabelledField/FieldRow, and the remaining fifteen panel migrations
status: building
touches: packages/design-system/src/lib/components/action-dialog/, packages/design-system/src/lib/components/maturity/ (new), packages/design-system/src/lib/components/labelled-field/ (new), packages/design-system/src/lib/components/field-row/ (new), apps/web/src/lib/maturity/ (removed), every apps/web file importing $lib/maturity, the fifteen panels named in tooling/lint-one-ui/registry.json hand-composed-modal allowances, tooling/lint-one-ui/registry.json, changelog.d/, docs/decisions/pending/
---

Owner-approved 2026-09-02 after the reading kind landed: wire Enter in the shell, add a field
layout primitive, let `subtitle` take a string, move `SoonAffordance` (and the maturity vocabulary
it is part of) into the design system, then continue the migrations. A concurrent stream should
stay out of the action-dialog directory, `apps/web/src/lib/maturity/`, and the fifteen panels
still carrying a `hand-composed-modal` allowance until this lands; each panel's allowance is
deleted in the PR that migrates it.
