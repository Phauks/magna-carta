---
slug: email-dkim-verdict-informational
status: Accepted
area: Email filing / capture
date: 2026-08-05
summary: "DKIM verification for captured mail is built as a pure-TypeScript RFC 6376 verifier over WebCrypto inside the platform, resolving selector keys over DNS-over-HTTPS — NOT inside the email-core parse engine, which keeps its parse-only, network-free boundary. The verdict is INFORMATIONAL and never a gate: no message is dropped, quarantined, refused, or auto-filed on the strength of it, which follows the subsystem's conversion-consent posture that the platform records facts and a person decides. The three-value verdict enum is not widened; every inconclusive outcome (unsigned mail, a .msg export with no signable original, a rotated-away selector, a resolver outage) stays `unverified` and is distinguished by a separate reason column, and a key that cannot be found is recorded as unverified rather than as the RFC's PERMFAIL, because archived correspondence routinely outlives the selector that signed it. A pass additionally records the signing domain; a fail records none, since a claimed d= the cryptography did not support is not an attribution."
---

**DKIM verification for captured email is an informational verdict computed in the platform, not in the parse engine, and never a filter.**

**Context:** The email record model has carried `email_message.dkim_verdict` since it was built, defaulted to `unverified`, with the DKIM/Authentication-Results/Received facts stored verbatim beside it. The parse engine records those facts and deliberately attaches no verdict — adjudicating them needs a DNS lookup of the signer's public key, which is I/O the engine must not have. What was missing was the consumer that fills the field, and the shape of the answer it records.

**Decision:**

1. **The verifier lives in `@magna-carta/email-filing`, in TypeScript, over WebCrypto.** RFC 6376 canonicalization and tag parsing are pure functions; the cryptography is `crypto.subtle` (RSASSA-PKCS1-v1_5 with SHA-256, and Ed25519 per RFC 8463 where the runtime offers it). No new dependency, nothing memory-unsafe touching hostile bytes, and no reason to grow the Rust engine a network boundary it was designed without. `rsa-sha1` is refused rather than accepted — vouching for a retired algorithm would be worse than recording that no answer could be given.

2. **The verdict is informational, and structurally cannot become a filter.** Nothing is dropped, quarantined, refused at an entrance, or auto-filed because of it. Verification runs after the capture has been parsed and persisted, on a path where its only output is a column; a verifier that throws records an honest inconclusive result rather than propagating and losing the message. This is the same posture the subsystem takes everywhere else: the platform records what it can establish, and a person decides what it means.

3. **Inconclusive is a first-class answer, told apart by a reason rather than by widening the verdict.** `dkim_verdict` keeps its three values, so it means exactly one thing to a reader; a new `dkim_verdict_reason` column carries which inconclusive case applies — unsigned, no signable original, unsupported algorithm, key unavailable, resolver failure. Conflating "no signature" with "signature failed" would misread ordinary internal correspondence as suspect, and widening a CHECK constraint in SQLite costs a table rebuild every time a new reason appears.

4. **A key that cannot be found is unverified, not a failure.** RFC 6376 treats a missing key record as a permanent failure. A legal file holds correspondence for decades, and a selector routinely rotates away long before the mail stops mattering, so applying the strict reading would mark a large fraction of a firm's archive as failed on the strength of DNS that has simply moved on. An *explicitly* revoked key (an empty `p=`) stays a definite failure, because there the signer has said so.

5. **Only a pass names a domain.** `dkim_verified_domain` is written from `d=` when a signature verified and left null otherwise. Recording the claimed domain of a signature that did not verify would read as an attribution the cryptography never supported — precisely backwards on the one record a dispute would turn on.

6. **A forwarded copy failing is expected, and readable as such.** Forwarding rewrites headers and breaks the original signature, so the forward/CC entrance will commonly record a failure that says nothing about the sender. The row already carries `captured_via`, so the pair (verdict, entrance) is what a reader weighs; the auto-file "DKIM-authenticated sender" guardrail is therefore scoped to captures that carry an intact original, which today means the add-in entrance.

**Consequences:** The auto-file rule engine's guardrail now has the signal it was waiting on, though the engine itself remains unbuilt. The correspondence-timeline UI gains a fact to render and inherits the obligation to render it as information rather than as a warning badge. The capture path acquires one outbound network dependency (a DNS-over-HTTPS resolver, configurable per deployment) whose unavailability degrades to `unverified` and is never able to block a capture. `.msg` captures can never carry a verdict, which is a property of the format rather than a gap to close.
