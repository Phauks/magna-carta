---
number: 389
slug: an-exported-write-with-no-caller-is-a-gate-failure
status: Proposed
date: 2026-08-19
area: Platform / Architectural integrity
summary: "A fifteenth repo-wide lint, pnpm run lint:unwired-writes, fails any exported write-shaped function in apps/ or packages/ that nothing outside a test references. It exists because two subsystems shipped inert and neither had a failing test: the email auto-file engine evaluated a candidate set nothing could add to, and three notification settings were read on every fan-out and every sweep and writable by nothing. Both were found by a person, and in both cases the tests wrote the rows themselves. Measured against the whole tree in two variants before it was kept. The strict form — no non-test reference anywhere outside the definition line — reports 4 of 272, every one an allowlist entry with a written reason; replayed against the tree one commit earlier it reports 10, including the three auto-file writers. The looser form — no reference outside the defining FILE — reports 9, and all five extra hits are the same correct idiom: a statement composed into an ordered batch by a helper beside it. The looser form is rejected on that measurement. A blank allowlist reason, an entry for a name that no longer exists, and an entry whose function has gained a caller are each failures, so the gate cannot go quiet by accident."
---

**A write nobody calls is a capability nobody can perform, and it is the one defect a test suite is
structurally unable to notice — because the test is the caller.**

**Context:** Two subsystems shipped correct, tested and inert. `createEmailAutoFileRule` had exactly
one non-test reference in the repository and it was its own test file, so the auto-file engine
evaluated an always-empty candidate set on every unrouted capture from the day it landed. Then the
same mechanical question, asked over every exported write-shaped function in `apps/` and `packages/`,
independently rediscovered that case and found three more in one subsystem: the firm tier of the
notification preference matrix, the retention window and the digest local hour, all read at evaluation
time and settable by nobody.

The failure mode is quiet by construction. The read side goes on working and goes on returning the
default; nothing throws, nothing 500s, no assertion fails. And the tests cannot catch it, because a
unit test of a statement builder calls the statement builder — which is precisely the reference the
production path is missing.

**Decision:** `tooling/lint-unwired-writes`, wired as `lint:unwired-writes` in the root
`package.json`, which is how the repo-wide gate discovers its members. One rule: an exported function
whose name begins with a write verb (`create`, `insert`, `write`, `record`, `enqueue`, `grant`,
`revoke`, `suspend`, `resume`, `promote`) followed by a capital, defined under `apps/` or `packages/`,
must have at least one reference in the non-test corpus outside its own definition line. References
are counted from `apps/`, `packages/`, `tooling/`, `tools/` and `plugins/`, so a write only a build
step performs is not mistaken for an unreachable one.

**The measurements that set the shape.** The rule was run over the whole tree in both plausible forms
before either was kept:

| Variant                                              | Hits | Real gaps | Deliberate | Test utility |
| ---------------------------------------------------- | ---- | --------- | ---------- | ------------ |
| No reference outside the **definition line** (kept)  | 7    | 3         | 3          | 1            |
| No reference outside the **defining file** (rejected) | 12   | 3         | 8          | 1            |

Measured on `main` at the commit this work branched from, over 272 exported writes. The kept variant's
seven were the three notification writers now built, two control-plane statements seeded by hand, one
unused port factory, and one in-memory test logger. The rejected variant adds five more, and all five
are the same correct idiom — `insertIndexSplitStatement`, `insertIndexSplitMemberStatement`,
`insertSystemMatterStatement`, `recordDigestRunStatement`, `recordInAppSuppressionStatement` — a
statement composed into an ordered batch by a helper in the same file, where the helper is what
production imports **because the ordering is the invariant**. Counting a same-file composition as
unwired would make the gate fire on the pattern this repository uses for every write whose ordering
matters, which is the "13 hits, 13 false" shape that got three ledger-staleness rules thrown away.

**Replayed against the tree as it stood one commit earlier**, the kept variant reports ten, and the
three extra are `createEmailAutoFileRule`, `resumeEmailAutoFileRule` and `revokeEmailAutoFileRule` —
the exact subsystem that had to be found by hand. That replay, not the count on today's tree, is what
earns the gate.

**Considered and rejected.** **Widening to every exported function, not only writes** — a package's
public surface legitimately exceeds what the monorepo calls today (types, predicates, readers a future
surface will consume), and nothing cheap distinguishes a deliberate API from a dead one. The write
verbs are the narrowing that makes the answer mean something: a write nobody performs is a decision
nobody can record, which is a different class of defect from an unused helper. **Counting references
from test files** — that is the entire premise; a test calling a write is what both known instances
had. **Leaving it as an occasional probe** — the probe is what found both, but it found the second one
six months after the first, and a question worth asking twice is worth asking on every push at 0.4
seconds.

**The allowlist is the review, and it cannot decay silently.** Four entries today, each with a written
reason: a test logger; a port factory whose underlying function production calls directly; and two
control-plane tables — `platform_operator` and `platform_staff` — whose rows are seeded by hand because
the platform has no self-service grant surface for either, by decision rather than by omission. Three
further conditions are failures of their own: a blank reason, an entry naming a function that no longer
exists, and an entry whose function has since gained a caller. A vacuity guard fails the run if the
scan finds no definitions at all, which is how a pattern change would otherwise turn the gate into a
no-op nobody notices. The rules self-test against fixtures on every invocation, the same shape as
`tooling/lint-ledger-staleness`.

**Consequences:** 0.4 seconds, in the always-on inner-loop set with no `DEFERRED_LINTS` entry. The
next unwired write fails on the pull request that adds it, and the next deliberate seam gets a written
reason instead of a silence. What the gate does **not** catch, and no rule here pretends otherwise: a
writer that has a caller which itself is unreachable, and a capability with no writer at all — the
firm's email detail-level ceiling is exactly that second shape and had to be found by reading.
