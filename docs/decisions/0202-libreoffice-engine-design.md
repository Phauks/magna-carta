---
number: 202
slug: libreoffice-engine-design
status: Accepted
date: 2026-08-04
area: File conversion
summary: "The LibreOffice conversion engine runs as a standalone network-isolated Container whose supervisor manages a pool of long-lived, single-threaded LibreOfficeKit worker child processes — one conversion at a time per worker, recycled by process replacement on conversion count, resident-memory ceiling, deadline, or crash. The binding is the pure-Rust jacobtread/libreofficekit crate (dlopen2, no build.rs/cc/bindgen/-sys), pinned exactly, with vendoring as the scoped fallback. The LibreOffice C++ runtime is owner-consented under golden rule 14; the consent covers the dlopened suite only, and every layer we write around it stays Rust."
---

**The office conversion engine is a warm LibreOfficeKit worker pool inside a sealed Container,
reached through a pure-Rust binding.**

**Context:** `packages/conversion/src/registry.ts` has declared `docx→pdf`, `odt→pdf`, `docx→odt`,
and `wpd→odt` for two months, all resolving to the deferred port. The per-engine dispatch seam has
now landed (`CONVERT_WORKER_ENGINE_IDS` in the app worker, `engineTargetFor` in the convert worker),
which makes a new engine an additive entry plus a Container class rather than an orchestration
change. The runtime placement was settled by prior research — a standalone conversion Container, not
the interactive editing tier — and so was the mechanism in outline: a LibreOfficeKit process pool
modelled on Collabora Online's `convert-to` internals, one conversion per instance because naive
concurrent `soffice --convert-to` fails silently, with Carlito and Caladea baked in for
metric-compatible layout. What remained open was the binding, the pool's exact shape, the format
matrix, the image, and the wiring.

**Decision — the pool.** A supervisor process (the axum host) manages `pool_size` long-lived worker
child processes, each initialising LibreOfficeKit exactly once at start-up and then serving one
conversion at a time for the rest of its life. Document bytes never cross the supervisor-worker pipe:
LibreOfficeKit is path-based, so the supervisor materialises each job into a per-job directory on the
container disk and sends paths in a manifest. Each worker holds its own `UserInstallation` profile,
so profile-lock contention cannot arise. A worker is retired and replaced on any of four conditions —
conversion count past its quota, resident set past a ceiling read from `/proc`, a conversion past its
deadline, or a non-zero or signalled exit — and recycling is *always* process replacement, because
the binding documents that creating a LibreOfficeKit instance after destroying one segfaults. A
replacement is started before a healthy over-quota worker is retired, so a scheduled recycle never
appears as latency. A wedged or crashed conversion kills its own child and nothing else; the
supervisor holds no LibreOfficeKit state of its own.

**Decision — the binding.** `jacobtread/libreofficekit`, pinned exactly, `Cargo.lock` committed. It
loads the suite through `dlopen2` at run time with no `build.rs`, no `cc`, no `bindgen`, and no
`-sys` crate, so no C++ toolchain enters the image build and nothing memory-unsafe is compiled into
our binary. Its `!Send`/`!Sync` types and its documented single-instance-per-process and
no-recreate-after-destroy constraints are what the pool design above is shaped around, so the crate's
limitations are load-bearing rather than incidental.

**Decision — the golden rule 14 consent.** The LibreOffice C++ runtime is owner-consented. There is
no Rust library that reads DOCX, ODT, and WordPerfect at usable fidelity, and a partial reader would
produce conversions a firm cannot file. The consent covers the dlopened suite and nothing else: the
supervisor, the worker protocol, the HTTP host, the packager, and the binding are all Rust. The
compensating controls are the ones the scan container established — no outbound network, an
unprivileged user, a per-job directory removed on every exit path including the crash path, a
per-worker memory ceiling, a deadline enforced by killing the child, and macro execution disabled in
the baked profile — plus the structural one that matters most here: the consented C++ always sits on
the far side of a process boundary from anything that decides.

**Considered & rejected:** *forking from a warm template as Collabora does* — `fork()` from a
multi-threaded async runtime is not safe, Collabora's `ForKit` is hand-written C++ that is careful
about exactly that, and the saving it buys is one we do not need, since a warm worker amortises
LibreOfficeKit initialisation across its whole life rather than paying it per job. *A hand-written
thin Rust wrapper over the LibreOfficeKit C API* — writing it means writing the crate above; kept as
the scoped fallback if the crate goes dark, since its surface is a `dlopen` shim over a stable C
ABI, not a parser. *`libreoffice-rs`* — last released April 2023 and binds the C++ headers, which
drags the software development kit and a C++ toolchain into the build. *Driving `soffice
--convert-to` per conversion* — silent failure on concurrency is the worst possible shape for a
system that files documents, plus full suite start-up per job and no structured error channel.
*Debian's `libreoffice-core` package* — Debian's archive serves only a package's current version, so
a Dockerfile pin 404s the moment a security update rotates it, breaking the reproducibility the pin
existed to provide; the upstream Still-branch bundle, SHA-256-verified at build time and installed
under `/opt`, is the same build-time-fetch/runtime-sealed pattern the scan and OCR containers already
use. *Publishing HTML as a conversion source format* — it is the email path's internal intermediate,
and exposing it would be an arbitrary-HTML-to-PDF endpoint, the server-side-request-forgery-shaped
surface the research warned against. *Declaring a `pdf→docx` edge* — LibreOffice imports PDF through
Draw and produces a collage of text boxes, so the edge would be a fidelity lie told through a
data-driven menu.

**Consequences:** The four registered office edges become executable, and `wpd→pdf` runs as the
two-hop chain pathfinding already computes. The container image lands around one gigabyte — an order
of magnitude above every other container here — which is felt in continuous integration on every
change to that directory and is why the fetch-and-install layer is keyed on the version argument
alone. Cold start is twenty to thirty seconds of LibreOffice initialisation, so `/ready` reports
ready only once a worker can actually convert, and the Container class idles longer before scaling to
zero than the raster engine does. A LibreOffice or font upgrade can change layout, so both are pinned
and an upgrade is a deliberate change that regenerates and reviews structural golden files. The
per-job directory is defined as a *package* from day one — a manifest plus one or more files — so the
email-to-PDF render engine later adds a packager and one dispatch arm rather than reopening this
design.
