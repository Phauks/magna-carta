---
number: 339
slug: the-conversion-gate-is-on-the-firms-procedure-never-on-a-verdict
status: Proposed
date: 2026-08-15
area: Client intake
summary: "Opening a matter out of intake is gated on four conditions the conflicts posture read already computes — no check has ever run, the latest check's scope falls short of the firm's live floor, a surfaced hit carries no disposition, or a re-check request is open — and on nothing else. Every one is a fact about the firm's own procedure rather than a conclusion about the client, so the gate concludes nothing and the engine's refusal to return a verdict is preserved intact. A matter with fourteen tier-1 hits, each disposed by a named partner with a rationale, passes; a matter with zero hits and no check does not, and that asymmetry is the whole argument. The scope condition costs nothing because the shortfall is derived against the live policy row on every read, so raising the firm's floor fails the gate on every affected matter immediately with no sweep and no write. Whether the gate is a hard refusal or an override is the owner's call; an override is a named member, a mandatory rationale and an audit row either way."
---

**The platform cannot gate on "there is a conflict" because it never concludes one — so it gates on
whether the firm looked, how thoroughly, and whether anybody answered what surfaced.**

**Context:** a firm must check for conflicts before it engages, which makes the intake-to-open
transition the natural place for a gate. But the conflicts engine deliberately produces no verdict:
the sanctioned posture read has no aggregate, no field named clear, clean, passed, status or
severity, and its one boolean reports whether a search happened rather than what one concluded. A
gate reading "no conflict" would have to invent the conclusion the engine spent a whole subsystem
refusing to draw, and would be enforced by a threshold — the mechanism for converting missed
conflicts into invisible ones.

**Decision:** the gate reads four conditions, all of which the posture read already computes and none
of which is a conclusion about the client.

The matter has **never been checked**. The latest check's **scope falls short** of the firm's current
floor. A surfaced hit **carries no disposition**. A **re-check request is open**. While any of the
four holds, the matter may not be opened.

Each is a statement about the firm's own procedure — it has not looked, it looked less thoroughly
than it now requires, something surfaced and nobody answered it, the corpus moved and the answer has
not been re-derived — and a firm can defend every one of them in front of a disciplinary body without
the platform having claimed anything about the client. The asymmetry this produces is the point: a
matter carrying fourteen strongest-tier hits, every one disposed as waived or walled by a named
partner with a rationale, passes the gate; a matter carrying none, with no check behind it, does not.

The scope condition is the cheapest and the strongest. The shortfall is compared against the **live**
policy row on every read rather than written onto a record, so a firm raising its conflicts floor
fails the gate on every affected matter from that instant, with no sweep, no backfill and no stored
judgement to rot.

The gate is registered as a named precondition on the open transition by the composition root, in the
shape the close preconditions already take — the conflicts rule lives with conflicts, and the matter
shell never imports the conflicts engine to discover whether it may open a matter.

**Whether the gate refuses hard or permits a recorded override is reserved to the owner**, as a
professional-conduct question rather than an engineering one. Either way an override is a distinct
permission, a named member, a mandatory rationale, an audit row, and a posture reproducible from the
append-only log as at that instant. An override that leaves no trace is worse than no gate, because
it produces a record that looks like compliance.

The gate is never reached from an automated path. A run nobody asked for, under nobody's authority,
may not record a member as having concluded anything, and the source-text rule that keeps the
automated re-check consumers away from the disposition writer holds for intake's conversion path too.

**Considered and rejected:** gating on hit count or evidence tier (a threshold, and the engine has
none by design); gating on a stored "cleared" flag (a written judgement that goes stale the moment
the corpus or the firm's floor moves); no gate at all with a warning banner (the obligation is to
check before engaging, and a banner is not a procedure); letting a pipeline stage carry the gate (a
firm renaming or deleting a stage would move or remove an ethics gate by editing a text column).

**Consequences:** intake inherits the whole ethics posture without relaxing a word of it, and the
gate's four conditions need no new column anywhere. The cost is that a firm with an open re-check
request cannot open a matter until the drain catches up, which is a real operational edge and the
substance of the owner's flag.
