---
number: 337
slug: an-intake-stage-is-firm-vocabulary-and-gates-nothing
status: Proposed
date: 2026-08-15
area: Client intake
summary: "The platform ships the shape of a lead pipeline and the firm defines the stages — per-firm ordered rows, soft-deactivated rather than deleted, seeded at provisioning — on the same pattern as matter types, party roles, Directory categories and custom fields. The binding rule is that a stage carries no authority: it is a label and a sort order, it gates nothing, permits nothing, and is never read by a precondition or a permission check. The moment a stage gates conversion, a firm renaming a stage moves an ethics gate by editing a text column and a firm deleting one removes the gate entirely; the things that gate are platform-owned and unrenameable. A stage change is append-and-flip so a lead's progress survives, and nothing about a stage survives conversion — an open matter has no stage, because the funnel ended."
---

**A pipeline stage is a firm's own word for where a lead is, and a word a firm can rename must never
be load-bearing.**

**Context:** competitors monetise the funnel and every one of them ships stages. The question is
whether the platform fixes the list or the firm does, and the house answer is close to unanimous
already: matter types are per-firm rows, party roles are per-firm, Directory categories are per-firm
labels, custom fields are per-firm definitions. A fixed stage enum would be the only closed list in a
subsystem surrounded by open ones, and firms genuinely differ — a personal-injury intake and a
transactional one do not share a funnel.

**Decision:** `intake_stage` is a per-firm ordered row set — name, sort order, active flag —
soft-deactivated rather than deleted, seeded at provisioning so a firm does not start at an empty
board. The current stage sits on the prospective matter, changed by an audited write, append-and-flip
so the history of a lead's progress survives rather than being overwritten.

The rule that makes it safe: **a stage carries no authority.** It is a label and a sort order. It
gates nothing, permits nothing, and no precondition, permission check or transition guard ever reads
it. This is not a style preference. A stage named "Conflicts cleared" invites exactly the
implementation where conversion requires that stage — and then a firm renaming it to "Ready" moves an
ethics gate by editing a text column, and a firm deleting it removes the gate with no error anywhere.
The things that gate are platform-owned and unrenameable: the conflicts posture, the close
preconditions, the permission registry. This is the classification-label-not-a-schema-variant rule
already settled for Directory categories, applied to the funnel.

Nothing about a stage survives conversion. An open matter has no current stage, because the funnel
ended; the stage history remains, because what happened remains.

**Considered and rejected:** a shipped stage enum (the only closed list in an open subsystem, and
wrong for half of practice); a stage as a state machine with permitted transitions (a firm's funnel is
not a workflow engine, and the transition table becomes the gate this decision exists to prevent); a
stage on the Directory entity rather than the matter (a person can be a lead on two matters at once);
in-place stage updates (a lead that moved backwards is a fact a firm wants and an overwrite discards).

**Consequences:** the pipeline is a rendering of prospective matters ordered by a firm's own labels,
and it can never disagree with the Consultations view because it reads the same rows. The enforcement
of the no-authority rule is a source scan — no gate imports the stage reader — because it is exactly
the rule a well-meaning later change breaks.
