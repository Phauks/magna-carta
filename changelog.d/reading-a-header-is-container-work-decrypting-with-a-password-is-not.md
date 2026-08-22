---
category: Changed
audience: internal
---

**The app worker no longer parses an uploaded file's encryption header itself — but it still holds
the decrypt, and that is deliberate.**

`POST /api/v1/decryption/inspect` and `POST /api/v1/decryption/recover` both did the same thing
first: initialise the WebAssembly build of `decryption-core` inside the request isolate and read a
recovery hash out of a member's encrypted file. That parse now runs in the Container
`apps/recovery-worker` already owns, over the `RECOVERY_SERVICE` binding it already declares, behind
a port in `apps/api-worker/src/decryption/`. `containers/recovery` gains `POST /extract-hash`; the
worker forwards it; nothing about the parse needs a key, so nothing about the routes' key handling
moved. The recovery route also stops classifying the tier locally — it arrives on the engine's reply
beside the hash, so the two can never disagree about what was read.

**Three states, and only the middle one is a verdict.** No binding at all, bound and answering,
bound and failing. A hash or a stable refusal code (`notEncrypted`/`unsupported`/`malformed`) is a
fact about the member's file and stays a `400`; an absent engine and an unreachable one are facts
about the deployment and are now a retryable `503` with distinct wording and no Error ID. Both
routes go through one mapping, `decryptionEngineProblem`, so a third route that reads a header
cannot invent a fourth answer. The container's status codes are the contract — 200, 422, 5xx — and
the proxy passes all three through unchanged, because collapsing two of them on either side turns an
outage into a diagnosis of somebody's file.

**What did not move, and why it is not an oversight.** `POST /api/v1/decryption/unlock` still calls
`stripWithKey` on the in-Worker WebAssembly. Its argument is the file's own password. Sending that
across the binding would put a firm's document secrets into a long-lived Container that is shared
across firms and whose day job is running a password search — a change to where secret material
lives, which is an owner's call and not a refactor's. So the app worker keeps its
`@magna-carta/decryption` import, `rust-wasm-build` keeps building `decryption-core`, and the header
read alone does not free the worker build of Docker. `ROOT_KEK` and the per-firm key providers were
not touched and nothing that is or wraps a key crosses the binding.

Adding a declared response changes the API contract, so the committed OpenAPI snapshot and the
generated client move in the same commit. Only the two routes that read a header gained the `503`.
