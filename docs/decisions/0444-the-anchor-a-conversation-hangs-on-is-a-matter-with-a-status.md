---
number: 444
slug: the-anchor-a-conversation-hangs-on-is-a-matter-with-a-status
status: Accepted
date: 2026-09-07
area: Communications layer
summary: "A logged call or text hangs on a matter identified by its STATUS, never by its number, and the surfaces that pick one must offer every status a firm can hold a conversation under. `matter.matter_number` is null until the status reaches `open`; an intake carries no number of any kind and a consultation carries only a tentative one, and those two are precisely where a first contact lands — a firm texts a prospect before the file exists. So the routable set is intake, consultation, open and hold, checked on the status column, and a closed matter is refused a NEW filing while keeping everything already on it. The consequence that costs something is the picker: the docket's own listing deliberately excludes intakes, on the sound reasoning that a docket listing every phone call would bury the firm's files under its own front door, so the surface that files phone calls cannot reuse it and walks a third stream instead. Rejected: requiring a numbered matter, which would refuse the commonest case the feature exists to serve and teach firms to open files early to record a call; and inventing a second anchor entity for prospects, which would duplicate the lifecycle the matter shell already models across five statuses."
---

**A conversation is anchored to a matter with a status, not to a matter with a number — and the
pickers that choose one must say so, because the default answer they would otherwise give is wrong.**

**Context:** the call and text log stores a nullable matter on every row. The obvious reading of
"a call belongs to a matter" is a numbered matter, and every picker in the product that offers
matters was built for the docket, which is a list of numbered work.

That reading is wrong here, and wrong in the one case the feature most exists for. The matter shell
already models five statuses — `intake`, `consultation`, `open`, `hold`, `closed` — and
`matter_number` is drawn only when a matter reaches `open`. A consultation carries a tentative
`consultation_number` from creation, because, as the schema puts it, "a consultation is a real thing
a firm has to be able to name". An intake carries nothing at all.

**A first phone call from a stranger is the most important call a firm takes and there is no file to
put it on.** That call is an intake. Requiring a number would refuse it, and the workaround a firm
would find — opening a numbered file to record a phone call — is worse than the problem.

**Decision.** The routable set is `intake`, `consultation`, `open` and `hold`, checked on the status
column. A closed matter is refused a new filing while keeping every conversation already on it:
reopening exists, and a firm quietly accreting correspondence onto a closed file is how a closed file
stops meaning anything.

**What it costs, stated rather than discovered later.** The docket's own listing excludes intakes on
purpose, and that reasoning is sound for a docket: one listing every phone call would bury the firm's
files under its own front door. It is wrong for the surface that files phone calls, so that surface
walks its own three streams — caseload, consultations and intakes — rather than reusing the docket
read. Any future picker for this subsystem inherits the rule, and a picker that filters to
`status = 'open'` makes the common case unroutable.

**Considered and rejected.** *Requiring a numbered matter*: refuses the commonest case, and teaches
firms to open files early. *A separate prospect entity to anchor early conversations*: duplicates a
lifecycle the matter shell already models, and would need its own conflicts, directory and access
story to hold a conversation the matter shell can hold today.
