---
category: Changed
audience: internal
---

**`POST /api/v1/decryption/unlock` now decrypts in the recovery Container, which means a member's
document password crosses a service binding. The owner authorised that, having been told the risk
twice, to finish taking the WebAssembly build out of the app worker's deploy.**

The header read moved first and deliberately left this behind, because `stripWithKey`'s argument is
the file's own password and the Container it would travel to is long-lived, shared across firms, and
otherwise employed running password searches. That is a decision about where secret material lives,
not a refactor, and it was made rather than assumed. `containers/recovery` gains `POST /unlock`;
`apps/recovery-worker` forwards it verbatim; the app worker calls it through the same
`resolveDecryptionEnginePort` the inspect and recovery routes use.

**Because it is authorised rather than harmless, the containment is built as an obligation.** The
password is not loggable, not countable, and not dimensionable: no log line, no telemetry dimension,
no metric label, no error message, no URL, no header, no retry buffer, and no audit row. Every
failure path names the transport or the status code and never the input — including the
wrong-password verdict, which reports that the decrypt failed and never which string failed. Tests
assert exactly that rather than trusting it.

**The framing is why it is only in the body.** The request is
`[u32 big-endian password length][password][file]` as `application/octet-stream`. A header or a
query parameter is the part of a request that proxies and access logs record by default; a JSON body
is a body a deserializer can quote back in an error. A length-prefixed body is neither, and the
container's own framing complaints name lengths only. On the Rust side the request buffer is wiped
in place and the owned copy lives in a `Zeroizing<String>`; what the format adapters copy internally
is documented rather than assumed — `lopdf` builds a sanitized `Vec<u8>` of the password and drops
it unwiped, and the `zip` crate copies it into its cipher state the same way. Neither retains it
past the call.

**Same three states as the routes beside it.** No binding → a `503` saying no engine is wired; bound
and answering → the plaintext, or a `400` carrying a stable code (`wrongPassword`, `notEncrypted`,
`unsupported`, `malformed`); bound and failing → a retryable `503`. Neither `503` mints an Error ID,
and a non-200 from the engine is a fault and never a `wrongPassword` — telling someone their
password is wrong because a Container did not start is the specific mistake that branch exists to
prevent. The `tools:decryption` chokepoint gate and the `decryption.unlocked` audit row are
unchanged, with the engine call between them; the audit's format field now comes from the engine's
own reply rather than a second local detection, so the record cannot disagree with what was read.
`ROOT_KEK` and the per-firm key providers are untouched, and nothing that is or wraps a platform key
crosses the binding.

Adding a declared response changes the API contract, so the committed OpenAPI snapshot moves in the
same commit.
