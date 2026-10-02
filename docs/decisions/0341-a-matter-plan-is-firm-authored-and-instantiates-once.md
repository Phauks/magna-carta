---
number: 341
slug: a-matter-plan-is-firm-authored-and-instantiates-once
status: Proposed
date: 2026-08-15
area: Tasks and workflows
summary: "The platform ships no matter-plan templates and every plan is firm-authored, for the reason the calendar refuses to compute deadlines: a plan is a statement about how this firm practises in this jurisdiction, so a platform-shipped plan with a missing step or a step that is right in one state and wrong in another is a malpractice vector carrying the platform's name, trusted precisely because it shipped. What ships is an empty catalog and an authoring surface; if a curated set is ever wanted the pattern already exists in the tree as jurisdiction-keyed reference data with attorney review in the loop, and that is a research workstream rather than a seed migration. Instantiation is a one-time copy with no live link: instantiated tasks carry the template identifiers as provenance and never as a reference the read resolves, so editing or deactivating a template does not touch a task on an open matter — a template edit that silently moved a due date on a live matter would be a docketing change nobody authorized and nobody saw. Nothing reconciles: there is no drift report and no plan-has-changed prompt, because both are the live link wearing a disguise. Sequencing is a single blocked_by predecessor that renders and sorts and gates nothing, because a platform that enforces order on a checklist is a platform people stop using the checklist part of."
---

**The platform ships no plans, and an instantiated plan forgets the template it came from the moment
it is written.**

**Context:** every competitor in this category ships a library of matter plans, and a firm evaluating
this platform will notice their absence on the first demo. The white paper promises templated
task, event and document sequences per matter type, auto-instantiated when a matter opens. This is the
spec that has to say what a template actually is and who writes it.

**Decision one: the platform ships none.**

A plan is a statement about **how this firm practises in this jurisdiction**. A platform-shipped plan
is the platform asserting a procedure — and a shipped plan with a missing step, or steps in the wrong
order, or a step that is right in Nevada and wrong in California, is a malpractice vector carrying the
platform's name. It is the calendar's argument about computed deadlines, transposed: it gets trusted
precisely because it shipped, and the firm that would have thought the sequence through does not.

What ships is an **empty catalog and an authoring surface worth using**. If a curated set is later
wanted, the pattern is already in the tree twice — the court-form library and the trust-rules
catalog are both jurisdiction-keyed reference data with attorney review in the loop and their own
confidence flags. A plan library is the same shape with the same obligations, which makes it a research
workstream and not a seed migration. That is raised as an open owner flag rather than closed here,
because it is a real competitive delta and the trade belongs to the owner.

**Decision two: instantiation is a one-time copy, and there is no live link.**

Instantiated tasks carry the template identifiers as **provenance** — so a firm can ask which matters
came off the old intake plan — and never as a reference any read resolves. Editing a template does not
touch a task on an open matter. Deactivating one does not either.

The reasoning is the calendar's position on recomputation, and it is the whole point: a template edit
that silently moved a due date on a live matter would be a docketing change nobody authorized and
nobody saw. A firm that corrects a template in March would find dates shifting on matters opened in
January, discovered by whoever missed one.

**Nothing reconciles.** No drift report, no "your plan has changed" prompt, no offer to re-apply.
Both are the live link wearing a disguise: the moment a surface tells a member their matter has
diverged from its template, the template is authoritative again and somebody will accept the
suggestion without reading it.

**Decision three: sequencing gates nothing.** A task may reference one predecessor in the same plan
instance. A blocked task renders as blocked and sorts below; it is **not refused, and completing it out
of order is allowed**. A firm's real sequence has exceptions constantly — the client sends the
documents before the engagement letter comes back — and a platform that enforces order on a checklist
is a platform people stop using the checklist part of. Cycles are refused at template-authoring time,
where the graph is small and static and the person who made the mistake is looking at it.

**Considered and rejected:** **shipping a small "obviously safe" starter set** — there is no such
thing; the safest imaginable plan still asserts an order, and the ones firms actually want are the
litigation sequences where being wrong matters most. **A live template reference resolved at read
time** — one template edit rewrites history across every open matter. **A drift report** — the live
link with an approval step, and the approval step is a button people press. **A full task dependency
graph** with multiple predecessors and rollup completion — it brings depth limits, cycle detection at
runtime and a recursive read the timeline cannot bound, for a checklist. **Blocking completion of a
blocked task** — enforcement on a soft record, which teaches people to route around it.

**Consequences:** a firm's first plan costs it real thought, which is the correct cost and the one the
platform should not pretend to absorb. Provenance columns make the reporting question answerable
without a live link. And the design leaves exactly one door open for a curated library later, behind an
owner decision and a research workstream rather than a migration nobody reviewed.
