---
category: Added
audience: internal
---

**Three merged designs had no ledger node at all, so the register could not see them and their open
owner flags had nowhere to land. Twenty-five nodes added across three new areas: exhibits, translation
services, and self-serve provisioning with the free evaluation tier.**

**These are not new scope, and the totals moving does not mean new work was promised.** Each of the
three designs is merged, which is to say the commitment was already made; the ledger simply never
learned about it, so the register was under-counting the program rather than over-counting it. This
is the same reasoning under which two shipped trust capabilities were given nodes last week —
recording work already committed is not the same as adding work. The owner reads the headline totals,
so it is worth saying plainly: 708 capabilities became 733, and not one of the 25 is a decision taken
here.

**Statuses are derived, not chosen.** Exhibits carries a merged design _and_ a merged sixteen-task
implementation plan with its slice fragment reporting no build begun, which the vocabulary calls
`planned` — eight nodes plus a root, with trial admission tracking `deferred` because the design
parks it and prints its three columns blank. Translation carries a merged design and no plan, which is
`designed` — six nodes plus a root, with human-attested certification `deferred` to the design's own
fourth slice. Self-serve is the one with code in it: registration is `shipped`, so its root is
`partial`.

**A finding worth stating: half of the self-serve design is already built.** The two-stage
registration split, the three-door role fork, the confirmed-registration outbox row and the
provisioning consumer that runs the existing provisioner off it are all on `main` under ADR-0280,
along with the `firm.display_name` split that took the firm's human name out of the unique resume
identity. What is _not_ built is everything the flags are about: no tier catalog, no tier column, no
quota ceiling, no upgrade-required refusal, and no lifecycle beyond provisioning.

**Eighteen of the twenty-three owner flags placed, on sixteen node lines; five left in their specs.**
The same rule as the last sweep: surface a
flag when the answer changes what gets built, leave out anything that only decides how an agreed
build is written. Placed — exhibits E1 and E4 (letter overflow past Z, which becomes a migration once
a label has been served, plus which numbering presets ship), E2 and E6 (how strict an issued set is),
E5 (package pagination against an already-stamped produced page), E7 (admission tracking at all), E8
(detecting prose references in a firm's existing documents); translation T1 (engine and vendor
posture), T2 (whether the provenance record exists), T3 (human certification), T4 (pasted text
recorded or ephemeral), T5 (derived sibling or new version), T8 (the machine-output statement on
every rendition); self-serve F1 (the free-tier numbers — the flag the founding-a-firm screen's
"starts on the free tier" line is literally waiting on), F2 (the reaping clock), F3 (trust on
verification or on payment), F4 (verification as review or attestation), F6 (metered tool allowances
or a hard lock). Left in their specs: exhibits E3 and translation T6 and T7, which decide wording and
plumbing on agreed builds, and self-serve F5 and F7, a legal-perimeter call and a nod to retire a
reserved route field.

No existing node's `status` was touched. `docs/now.md` is regenerated from the ledger, as always.
