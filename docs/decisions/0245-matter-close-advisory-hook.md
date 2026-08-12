---
number: 245
slug: matter-close-advisory-hook
status: Accepted
date: 2026-08-05
area: Matters
summary: "The matter close path gains a second, separate extension hook — a close ADVISORY that returns notices on the successful close response and has no arm on which it can refuse — rather than reusing the close-precondition hook with a non-blocking severity flag. Custody registers the first advisory: closing a matter surfaces the physical originals the firm still holds against it and never blocks. The advisory carries a count and nothing identifying, because closing a matter requires no custody permission."
---

**Matter close gets an advisory hook beside its precondition hook, not a softer flag on the same one.**

**Context:** Closing a matter already runs the close-precondition registry: each rule reads state,
any failure blocks the close, and each rule may contribute an in-batch guard that aborts the commit if
its condition changed. Trust registers the first such rule — a matter whose client trust ledger still
holds money does not close. Custody needs the opposite shape. A firm holds a client's original will
for decades after that client's last matter closed; that is the steady state of a safe-custody
register, not a loose end, and a packet may have no matter at all. Blocking a close on custody would
teach firms to unlink packets from matters before closing them, destroying exactly the connection the
notice exists to draw attention to. But a person closing a matter should still be told the firm holds
physical property against it.

The obvious cheap option was one registry with a `blocking: boolean` on each rule.

**Decision:** Two hooks. `ClosePrecondition` keeps `check` plus an optional `commitGuard`, and a
failure refuses the close. The new `CloseAdvisory` has one method, `notice`, returning notices that
ride the successful close response; it has no guard, no failure type, and no path by which a notice
becomes a refusal. The matter shell's own registry for both stays empty — the composition root
supplies rules and notices alike, so the shell never learns what money or property is. The close
response gains its own component carrying the notices, kept off the shared lifecycle acknowledgement
so a notice cannot appear on open, reopen, or renumber, none of which run advisories. Custody's
advisory reports a COUNT of linked packets and nothing that names the property, its owner, or its
number, because closing a matter requires no custody permission and the register's contents are a
disclosure in themselves.

**Consequence:** A subsystem that only means to inform cannot start blocking closes by flipping a
boolean — the types do not permit it, and an advisory has nothing to flip. Advisories take no
commit-time guard, and that is correct rather than an omission: there is nothing to re-assert, because
a notice that went stale between the read and the commit was still true of the matter the person was
looking at, and the subsystem it came from is where the state actually lives.
