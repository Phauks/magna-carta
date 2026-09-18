---
category: Changed
audience: public
---

**Every number the firm issues is drawn from one register.** The segment-template scheme engine
moves out of `@magna-carta/matters` into `@magna-carta/sequence-numbering` beside the counter
mechanism it already held, under a static register of purposes (`purposes.ts`) naming what each
sequence is, when it is drawn, whether the firm shapes it and with which parts, and what renders
until it does. Conflicts checks and custody packets join as scheme-shaped purposes: a check draws
through the shared planner and its own counter tables instead of `MAX + 1` under a hard-coded
`CC-` prefix, defaulting to `CC2026-00001` restarting each year; a packet draws from the
`custody_packet` purpose with its old `CUS-00001` shape as the default, and custodian's dead
fixed-shape model is deleted. Invoice, time-entry and call numbers are registered with their fixed
shapes. `GET /api/v1/numbering-schemes` lists the register; `Settings › Practice › Numbering`
(formerly Matter Numbering, which redirects) shows one plate per sequence. Decision:
`docs/decisions/pending/every-number-the-firm-issues-is-drawn-from-one-register.md`.

## Public

- Every number your firm draws now lives on one settings page, **Settings › Practice › Numbering**:
  matter, consultation, intake, conflicts check and custody numbers are each yours to shape, and
  the invoice, time entry and call numbers are listed with their fixed shapes so the page is the
  whole inventory.
- Conflicts check numbers are now drawn from a scheme your firm can change. The built-in shape is
  `CC2026-00001`, restarting each year with five digits, so the busiest sequence a firm has keeps
  the width you expect; checks numbered before this keep the numbers they had.
- Custody numbers are yours to shape as well. Nothing already labelled changes: the built-in shape
  is the `CUS-00001` your labels already carry.
