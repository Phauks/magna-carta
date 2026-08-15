---
category: Changed
audience: internal
---

**The scoped gate now names the one type error that is not a type error, and three documents that had
gone stale say what is true.**

**A stale workspace link stops looking like broken code.** After merging a trunk that added a package
or an export path, `tsc -b` reports `Cannot find module '@magna-carta/<something>'` against source
that is perfectly correct — workspace links resolve at install time, so the module is genuinely absent
from `node_modules` while the code and the reference graph are both right. It reads exactly like a
real break, and every time it has cost an afternoon of debugging something that was never wrong. The
remedy is `pnpm install`.

`pnpm check:scoped` now says so itself. The type-check step's output is captured rather than inherited,
and on a failure the gate applies the discriminator that was already in the repository and already
scriptable: if the errors carry `TS2307` against a `@magna-carta/` specifier **and**
`tooling/tsconfig-refs --check` reports every generated build config in sync, nothing about the
projects is stale, so the missing module is a stale link — and the gate prints the remedy. Both halves
have to hold. A hint that also fired on ordinary type errors would be worse than no hint, because it
would train everyone to scroll past the one time it is right, so it was verified in three directions:
it fires with a package's workspace links removed, it stays silent on an ordinary `TS2322`, and the
reference check exits non-zero (suppressing the hint) when a `package.json` really has outrun its
generated graph.

**Two trust documents caught up with the bank-charge carve-out.** `packages/trust-jurisdictions/CLAUDE.md`
and the comment on `cited.firmFundsForBankCharges` in `src/data/nevada.ts` both still said the carve-out
was encoded as a citation and not wired, and that the composition guard refused every posting to a
firm-funds node. `composeTrustFirmFundsEntry` and `openTrustFirmFundsNode` shipped on 2026-08-12. Both
documents now describe the carve-out as the **second door** it is — and the invariant they were making
is intact and stated with the same force, because it is still true: `composeTrustEntry`, the door client
money goes through, refuses a firm-funds line **absolutely**, and the second door admits strictly fewer
shapes rather than more. The Nevada comment's four unsettled points are kept and re-cast as what each
was answered with rather than invented: no cap is chosen (the node's zero floor aborts an over-large
charge instead), the carve-out is refused outright on a pooled interest-bearing account the rules exempt
from service charges, the no-commingling guard is unchanged, and the three-way proof carries the cushion
as its own leg.

**The white paper's _Payments_ card capture matches the accepted decision.** It described capture via
"hosted fields / tokenization (e.g. Helcim.js)" — the in-DOM tokenizer that ADR-0181 rejected **by
name** as SAQ A-EP. It now states the hosted payment modal returning an opaque `cardToken`, the
rejection of the in-DOM tokenizer and of the raw-card API, no PAN and no CVV stored, and a payment
surface free of third-party scripts. The payments design spec's note recording that drift is updated
to record it as resolved.

**A trap gets a warning where the mistake is made.** `idempotencyMiddleware` reads the request body
through `context.req.json()` to fingerprint it, which consumes the raw stream. Mounted in front of a
webhook route it destroys the bytes a signature is computed over, and the failure presents as a wrong
shared secret rather than as a consumed body — so the debugging goes into the credential store and
stays there. The middleware now carries that warning on itself, alongside what a signature-verifying
route does instead.
