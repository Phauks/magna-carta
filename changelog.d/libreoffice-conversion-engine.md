---
category: Added
---

**The LibreOffice conversion engine — the four registered office edges now have a body.**
`docx→pdf`, `odt→pdf`, `docx→odt`, and `wpd→odt` have been declared conversions for two months and
resolved to a deferred port that failed every job; `wpd→pdf` chains across them. `containers/libreoffice`
is the engine that runs them: a Rust supervisor with an axum surface, plus a pool of warm worker child
processes that each load LibreOffice once through a `dlopen`'d C ABI and convert one document at a time.

The suite is owner-consented C++ under the memory-safety rule — no Rust library reads those formats with
anything approaching this fidelity — and the consent buys exactly one thing: loading a shared library at
run time. Everything around it is Rust, the container has no outbound network, and the suite always runs
as an isolated child process, so a wedged or segfaulting conversion kills its own child and nothing else.
A worker is replaced (never rebuilt in place — the binding segfaults if an instance is recreated) when it
crosses its conversion budget, its resident-set ceiling, its deadline, or dies; a scheduled replacement is
warmed alongside the outgoing worker, so recycling is not charged to the request that triggered it.

`/ready` is honest: 503 until a worker has actually finished suite initialisation, which takes tens of
seconds, so the container never hands that delay to the first user request as an unexplained stall. A
failure is always a status, never an empty success — 415 for a format pair this engine does not serve, 422
for a document that reached the suite and could not be converted (including a password-protected one,
which is never guessed at), 503 when no worker was available, 504 on the conversion deadline.

Carlito and Caladea ship in the image and the acceptance suite asserts the embedded font names, so a
Calibri or Cambria document that silently fell back to Liberation — a layout shift, not an error — turns
the build red instead. The supervisor's whole state machine is proved by `cargo test` against a fake
worker that can be told to hang, crash, abort on a signal, run away with memory, or answer with garbage,
so the part most likely to be wrong is covered on any machine with no office suite installed.

Deploy is ordered: the convert worker carries the new Container class before the app worker starts routing
the engine. Still to come on this container: the email-to-PDF render engine, which consumes the job-package
seam and adds one dispatch arm.
