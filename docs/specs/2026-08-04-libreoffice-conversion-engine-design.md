# LibreOffice conversion engine — design

**Date:** 2026-08-04
**Status:** Design approved; implementation plan pending. No engine code in this cycle.
**Scope:** The `containers/libreoffice` engine, its process pool, its image, its HTTP contract, and
the additive wiring into the existing per-engine dispatch. Covers the four registered office edges
and carves the seam the email-to-PDF render engine will later occupy. Excludes: the render engine
itself, the matter-attached save-as-version path, the user interface, and any spreadsheet or
presentation format.
**Standard:** [`docs/conventions/engine-host-seam.md`](../conventions/engine-host-seam.md) —
the container follows that seam; the one documented divergence is named below.
**Decision inputs:** [`docs/research/in-app-conversion.md`](../research/in-app-conversion.md) settled
the runtime question already: a standalone conversion Container implemented as a LibreOfficeKit
process pool modelled on Collabora Online's `convert-to` internals (`kit/Kit.cpp` +
`ConvertToBroker`, Mozilla Public License 2.0), one conversion per instance because naive concurrent
`soffice --convert-to` fails silently, with Carlito and Caladea baked in. This design answers what
that research deferred: the binding, the pool's exact shape, the honest format matrix, the image,
and the wiring.

## Why now

Four conversion edges have been registered promises for two months. `packages/conversion/src/registry.ts`
declares `docx→pdf`, `odt→pdf`, `docx→odt`, and `wpd→odt`, and pathfinding already computes `wpd→pdf`
as a two-hop chain across them. Every one of those resolves to the deferred port and fails with
`engine-not-implemented`. The Convert-to menu is data-driven off that registry, so the menu will
offer conversions that cannot run the moment the interface ships.

The dispatch seam that was blocking this landed. `CONVERT_WORKER_ENGINE_IDS` in
`apps/worker/src/conversions/conversion-engine.ts` and `engineTargetFor` in
`apps/convert-worker/src/engine-dispatch.ts` together make a new engine an additive entry plus a
Container class — no orchestration change, no Durable Object change, no queue change. That is the
whole reason this can be a self-contained slice rather than a cross-cutting one.

## Golden rule 14 — the C++ consent, and where the boundary sits

LibreOffice is a large C++ office suite that parses adversarial, privileged document bytes. That is
precisely the exposure golden rule 14 exists to prevent, and there is no honest mitigation available:
no Rust library reads DOCX, ODT, and WordPerfect with anything approaching this fidelity, and the
partial Rust readers that exist would produce conversions a firm cannot file. The C++ runtime is
**owner-consented** on that basis — the same posture as clamd in the malware-scan container, and
narrower than the ONNX Runtime consent in the scan and OCR containers in one respect and wider in
another: narrower because LibreOffice runs in a sealed, egress-free container as an isolated child
process that dies without taking anything with it; wider because, unlike ONNX Runtime, it does parse
the untrusted bytes directly.

What the consent does **not** extend to is the binding layer. Everything we write around LibreOffice
is Rust: the pool supervisor, the worker protocol, the HTTP host, the packager, and the binding
itself. No C++ build toolchain enters the image build, no `-sys` crate, no `bindgen`, no `cc`. The
consent buys exactly one thing — the ability to `dlopen` a shared library at run time — and the
architecture below is shaped so that the consented code is always on the far side of a process
boundary from anything that decides.

The compensating controls are the ones scan established and this container inherits without
weakening: no outbound network of any kind, an unprivileged user, a per-job directory removed on
every exit path including the crash path, a per-worker resident-memory ceiling, a per-conversion
deadline enforced by killing the child, and macro execution disabled in the baked profile so a
converted document can never run anything.

## The binding — `libreofficekit`, adopted with a vendoring escape hatch

Three candidates, evaluated against the constraint that the binding layer should be Rust.

**`jacobtread/libreofficekit` (0.5.0, MIT) — chosen.** Its dependency list is `bitflags`,
`num_enum`, `dlopen2`, `once_cell`, `parking_lot`, `serde`, `serde_json`, `thiserror`, `url`. There
is no `build.rs`, no `cc`, no `bindgen`, and no `-sys` crate: the author reimplemented the
`LibreOfficeKitInit.h` bootstrap logic in Rust and loads the suite through `dlopen2` at run time.
That is the exact shape golden rule 14 asks for when a C++ core is consented — the C++ stays behind
a C ABI that Rust reaches dynamically, and nothing memory-unsafe is compiled into our binary. It has
been tested against LibreOffice 6.4.7.2 and 24.8.4.2 and targets whatever the standard
LibreOfficeKit C library supports, with missing version-specific entry points surfacing as a typed
`OfficeError::MissingFunction` rather than a crash. Its `find_opt_installs` / `find_opt_latest`
helpers exist specifically for suites installed under `/opt`, which is the layout the distribution
decision below produces.

Two properties of the crate are load-bearing for the architecture rather than incidental. `Office`
and `Document` are neither `Send` nor `Sync`, and the crate documents that using more than one
instance at a time in a single process segfaults — the single-instance-per-process constraint the
research identified, restated at the type level. And creating an instance after destroying one also
segfaults, which means a worker can never recycle its LibreOffice state in place: recycling is
process replacement, full stop. Both facts appear directly in the pool design.

**Maintenance, stated honestly.** Version 0.5.0 shipped 2025-06-08; the most recent commit is
2025-09-18; the repository has 23 stars and one maintainer; total downloads are roughly 16,500. That
is below the maintenance bar we would normally require of a load-bearing dependency, and it is the
same "load-bearing, needs audit" posture the research took toward `msg_parser`. Three things make it
acceptable here where it might not be elsewhere. The surface is small and fully auditable — a
`dlopen` shim plus typed wrappers over a handful of C entry points, not a parser. The interface it
wraps is the LibreOfficeKit C ABI, which The Document Foundation keeps stable across releases and
now promotes as the recommended conversion interface, so the crate has little reason to churn.
And the fallback is bounded and known: if it goes dark, we vendor it into `crates/` and own roughly a
thousand lines of foreign-function-interface code we have already read. The version is pinned exactly
and `Cargo.lock` is committed; an upgrade is a deliberate change, not a range resolution.

**A hand-written thin Rust wrapper over the LibreOfficeKit C API — rejected as the starting point,
retained as the fallback.** Writing it means writing the `dlopen` bootstrap, the function-pointer
table, the `DocUrl` handling, and the error mapping ourselves — which is to say, writing the crate
above. Doing that up front buys independence we do not need yet and costs a week we can spend on the
pool, which is where the actual risk lives. The moment the crate is unmaintained _and_ something
breaks, vendoring converts this rejection into the fallback at a cost we have already scoped.

**`libreoffice-rs` (undeflife, Apache-2.0) — rejected.** Its last release is 0.3.3 from
2023-04-14, and it binds the LibreOfficeKit C++ headers directly, which requires the LibreOffice
software development kit and a C++ build toolchain in the image build. That is strictly worse on
both axes we care about: it is more abandoned and it drags C++ compilation into our build.

**Driving `soffice --headless --convert-to` per conversion — rejected.** The research already
established the failure mode: concurrent invocations against one user profile fail _silently_,
producing no output and reporting no error, which is the worst possible failure shape for a system
that files documents. Beyond that, the process-per-conversion cost is a full suite start-up on every
job, there is no structured error channel (exit codes conflate "this document is broken" with "the
suite crashed"), and the filter-selection surface is a command-line string rather than a typed call.
It is retained only as the mental model for what we are deliberately not doing.

Collabora Online's `/cool/convert-to` endpoint remains the documented fallback runtime if the
LibreOfficeKit path proves unworkable, exactly as the research left it — but taking it would couple
conversion to the interactive editing tier's container model, which is the coupling the standalone
placement was chosen to avoid.

## The pool — warm workers, not forked children

Collabora's robustness comes from process-per-job plus a jail: a `ForKit` process holds
LibreOfficeKit pre-initialised as a warm template and forks one `kit` child per conversion, each in
its own jail, torn down when the conversion returns. Forking from a warm template is what makes
per-job process creation cost roughly six milliseconds instead of forty.

We take the isolation and decline the fork. A supervisor process — the axum host — manages a small
pool of **long-lived worker child processes**, each of which initialises LibreOfficeKit exactly once
at start-up and then serves conversions one at a time for the rest of its life.

The divergence is deliberate and worth stating plainly, because "modelled on Collabora" could
otherwise be read as "forks like Collabora". `fork()` from a process running a multi-threaded async
runtime is not safe: the child inherits the parent's address space with only the forking thread
alive, so any lock held by another thread at fork time is held forever, and only async-signal-safe
calls are legal between fork and exec. Collabora's `ForKit` is hand-written C++ that is careful about
exactly this and does very little between the fork and the point where the child takes over.
Reproducing that discipline underneath tokio is possible and unpleasant, and it buys us a saving we
do not need — because we are not paying LibreOfficeKit initialisation per job in the first place. A
warm worker amortises that initialisation across its whole lifetime, which is strictly cheaper than
Collabora's per-job fork, not merely comparable. What we give up is Collabora's per-job chroot jail;
the container is the jail instead, and the per-job directory plus the per-worker profile give us the
filesystem separation the jail was providing.

**Shape.** The supervisor owns `pool_size` ready workers plus, transiently, one warming replacement.
It hands each incoming conversion to an idle worker, or waits for one up to the acquire deadline.
The worker protocol is length-prefixed JSON over the child's standard input and output. Crucially,
**document bytes never cross that pipe**: LibreOfficeKit is path-based — `document_load` takes a
document URL and `save_as(url, format, filter)` writes to one — so the supervisor materialises the
job on the container disk and sends paths. The pipe carries a job manifest and a result, nothing
more.

**One conversion at a time per worker** is structural rather than policy: `Office` is `!Send` and
`!Sync`, a second concurrent instance in one process segfaults, and the suite is single-threaded per
instance regardless. Each worker additionally gets its own `UserInstallation` profile directory, so
the profile-lock contention that breaks concurrent `soffice --convert-to` cannot arise even in
principle.

**Health and recycling.** A worker is retired and replaced when any of four conditions holds: it has
completed `max_conversions_per_worker` jobs (starting at 50 — the office-convert-server project
reports segfaults accumulating across conversions on newer LibreOffice builds, and a bounded
lifetime is the cheap answer to a leak we do not control); its resident set, read from
`/proc/<pid>/statm`, exceeds the per-worker ceiling; a conversion exceeded its deadline; or it exited
non-zero or on a signal. Before the ceiling is consulted, the worker calls the binding's
`trim_memory` after each conversion, which is the cheap first line and often avoids a replacement
entirely. Recycling is **always** process replacement — the binding's teardown-then-recreate
segfault forbids anything else — and the replacement is started _before_ a healthy over-quota worker
is retired, so a scheduled recycle never appears as request latency. Only the unscheduled paths
(crash, deadline) can leave the pool briefly short.

**Crash isolation.** A wedged or segfaulting conversion kills its own child and nothing else. The
supervisor's deadline timer sends `SIGKILL`, reaps the child, deletes the job directory, returns a
deadline status to the caller, and starts a replacement asynchronously. A worker that dies on its own
is indistinguishable from that path and is handled identically. The supervisor holds no
LibreOfficeKit state itself, so there is no shared structure a child can corrupt — which is the
entire point of putting the consented C++ on the far side of a process boundary.

**Sizing.** Cloudflare's `standard-2` instance is one vCPU, six gibibytes of memory, and twelve
gigabytes of disk. Because LibreOfficeKit is single-threaded per instance, the intra-container
concurrency ceiling is the vCPU count, and the real concurrency lever for this engine is
`max_instances` — horizontal — not pool depth. So the pool starts at **two workers on `standard-2`**:
two lets one worker use the processor while another is blocked on disk or is being replaced, and
more than two would contend for a single core while multiplying the memory floor. A warm worker sits
around 250 to 400 mebibytes resident after initialisation and can reach roughly a gibibyte on a large
document, so two workers plus one warming replacement fits six gibibytes with real headroom for the
supervisor and the page cache the suite depends on. Job packages live on the container **disk**, not
a tmpfs, specifically so a large document consumes disk budget rather than the memory budget the
workers are sized against.

These numbers are a defensible starting point, not a measurement. Golden rule 10 applies: the pool
size, the instance type, and the recycle thresholds are re-derived against the load-profile harness
once there is a real conversion mix, and the honest possibility is that `standard-1` with more
instances beats `standard-2` with a deeper pool.

## Formats served — the honest matrix

The engine serves exactly the four edges the registry declares, and one chain.

| Source | Target | Recipe | Filter              | Notes                                                  |
| ------ | ------ | ------ | ------------------- | ------------------------------------------------------ |
| `docx` | `pdf`  | `pdf`  | `writer_pdf_Export` | The volume path.                                       |
| `odt`  | `pdf`  | `pdf`  | `writer_pdf_Export` | Same filter, different import.                         |
| `docx` | `odt`  | `odt`  | `writer8`           | OOXML to OpenDocument.                                 |
| `wpd`  | `odt`  | `odt`  | `writer8`           | WordPerfect import through the writerperfect filters.  |
| `wpd`  | `pdf`  | —      | —                   | Not an edge: pathfinding already chains `wpd→odt→pdf`. |

The chain deserves a note, because it is the one place where "two hops" is a real cost rather than
bookkeeping. The orchestrator executes it as two separate container calls with the intermediate ODT
crossing back through the worker; a single-call optimisation is available later (the worker could
load once and save twice) but it is an optimisation, not a correctness matter, and building it now
would put a special case in the dispatch for a path nobody has measured.

**What stays out, and why.**

_Spreadsheets and presentations._ No `xlsx`, `pptx`, `ods`, or `odp` format node exists, and adding
them is not a filter call. A spreadsheet has no intrinsic page geometry — print ranges, scaling,
repeat-rows, and orientation are decisions the converter would be making silently on the firm's
behalf — and presentations raise slide-notes and handout questions with no obvious default. Both are
additive registry edges plus a recipe vocabulary when someone wants them; neither is blocked by
anything in this design.

_Legacy `.doc`, `.rtf`, and plain text as public sources._ LibreOffice reads all three well. Each
still costs a format node, a media type, an upload-policy entry, and a golden fixture, so they are
additive rather than free, and none of them is on the roadmap for this slice.

_HTML as a public format node — deliberately absent._ HTML is this container's internal intermediate
for the email path below. Publishing it as a conversion source would expose an
arbitrary-HTML-to-PDF endpoint, which is exactly the server-side-request-forgery-shaped surface the
research warned about. It stays internal, reachable only through the email packager.

_PDF as a source._ LibreOffice imports PDF through Draw and produces a collage of text boxes, not an
editable document. Declaring `pdf→docx` would be a fidelity lie told through a data-driven menu.
PDF-as-source belongs to the pure-Rust PDF engine.

**The fidelity ceiling, stated rather than implied.** LibreOffice's DOCX rendering is very good and
is not Word. Complex numbering, floating-object anchoring, SmartArt, embedded OLE objects, and
tracked-change display can all differ. What this engine produces is a faithful conversion, not a
certified reproduction, and the acceptance suite pins _our_ rendering rather than Microsoft's. The
original is never mutated, which is what makes that acceptable: a firm that needs the Word rendering
still has the Word file.

## The email-to-PDF seam

The email render engine is a separate slice, and this container is its planned host. The one thing
this design owes it is a job contract that will not need redesigning when it arrives.

**The job unit is a package, not a body.** The supervisor already materialises each conversion into
a per-job directory; that directory is defined from day one as a _package_: a manifest naming the
entry document, the target format, and the recipe, plus one or more files. Today every package holds
exactly one file. The email path later writes `message.html` plus a `resources/` subdirectory of
extracted content-identifier parts, and changes nothing else — the worker protocol, the directory
lifecycle, the deadline, the recycle policy, and the crash path are all identical. The container
dispatches on the format pair, so `eml→pdf` and `msg→pdf` become new arms of the same dispatch, and
the container host crate gains a path dependency on `crates/email-core` — already built, pure Rust,
parse-only — to turn a parsed message into print-HTML.

**Resource resolution is the load-bearing policy.** The packager rewrites every `cid:` reference in
the message body to a relative path inside the package, and **drops** every absolute or remote
reference — `http:`, `https:`, `file:`, and oversized `data:` URIs — replacing each with a
placeholder. After packaging, nothing in the HTML that reaches LibreOffice can name anything outside
the job directory. That is enforced at three independent layers, any one of which would suffice:
the packager rewrites and drops; the worker loads the document with link updating disabled and
remote-content fetching off in the baked user profile; and the container runs with
`enableInternet = false` so there is no network to reach in the first place. All three are cheap and
none of them depends on the other two being correct.

`wkhtmltopdf` is not used, and this is recorded so nobody re-derives it: it was archived in January
2023, declared unmaintained in July 2024, and carries CVE-2022-35583, in which an injected
`<iframe>` in user-supplied HTML triggers server-side request forgery against internal metadata
endpoints. Email HTML is untrusted, externally-originated content — that is the threat exactly.

**Why LibreOffice renders the HTML, for now.** It is already here; adding it costs no new engine and
no browser in the container roster, which is the research's own lean. Its modern HTML and CSS email
fidelity is mediocre, and if exhibit fidelity ever demands better, a network-isolated headless
browser becomes a second render target behind the same `email` engine identifier. The package
abstraction is precisely what makes that a swap rather than a redesign: the packager's output — a
directory of self-contained files with no external references — is exactly what a browser renderer
would want too.

The attachment policy (embed each attachment in its original format versus append or convert them as
trailing pages) is the render slice's decision, not this one. The package manifest carries it as a
field so the container never has to learn about it.

## The container contract

**Placement.** `containers/libreoffice/`, crate `magna-carta-libreoffice`, built with
`engine_host::host` — `with_panic_net(ready_app(router()))` then `serve`, binding `0.0.0.0:8080` —
the same shape as `containers/file-repair` and `containers/ocr` rather than raster's hand-rolled
axum.

**One documented divergence from the engine-host seam.** That standard splits a pure engine crate in
`crates/` from a thin host in `containers/`, so one engine can compile to both WebAssembly and
native. There is no `crates/libreoffice-core` here, because a four-hundred-megabyte C++ suite reached
by `dlopen` can never be the WebAssembly lane; the split would be ceremony with no second target
behind it. The pool supervisor and the worker binary are two `[[bin]]` targets in the container
crate, over a shared library module, and the crate keeps the seam's other rules — pure-Rust features
only, no `r2` feature, the panic net, the `/ready` probe, the body cap, and raw results in the
container with the verdict in the app.

**HTTP surface.** `GET /ready` and `POST /convert`, matching the raster engine's wire shape exactly
so `forwardConvert` in the convert worker stays engine-agnostic.

`/ready` returns 200 **only once the pool has at least one worker that has completed LibreOfficeKit
initialisation**. This matters more here than anywhere else in the repo: initialisation takes tens of
seconds, and a container that reports ready before it can convert hands that entire delay to the
first user request as an unexplained stall. The response body also carries the suite version from
`get_version_info()`, which is the provenance seam described under risks.

`POST /convert` takes the source bytes as the body with `x-source-format`, `x-target-format`, and
`x-recipe` as headers. `x-engine-id` also arrives — `forwardConvert` forwards headers verbatim — and
is deliberately **not read**. Dispatch is on the format pair. That is what lets the `libreoffice` and
`email` engine identifiers share one container without the container knowing that engine identifiers
exist, and it keeps this contract identical to raster's.

The success response is 200 with the converted bytes as the body and the canonical media type as
`Content-Type` — bytes and a content type, no JSON envelope, matching the boundary the app-worker
adapter already expects. Failures map deliberately: **415** for a format pair this container does not
serve; **422** for a document that loaded and could not be converted, or one that is
password-protected (we never attempt a password — an encrypted document is a deterministic fact, the
same stance the scan engine takes); **503** when no worker could be acquired or a worker died in a
retryable way; **504** on the conversion deadline. There is never a 200 with empty bytes: a caller
about to file something cannot be left unable to distinguish an empty document from a failed one.

**Limits.** The `/convert` body cap is 256 mebibytes, the same value and the same reasoning as
raster's — the body is buffered before any guard can run, and office documents are far smaller than
the pipeline's general ingest cap. The per-conversion deadline is 120 seconds: a five-hundred-page
DOCX-to-PDF completes in seconds, so 120 means wedged, not slow. The pool-acquire wait is 30 seconds
before 503. Container boot to first ready worker is budgeted at 20 to 30 seconds, which is why
`/ready` is honest and why the Container class's `sleepAfter` is longer than raster's.

**Isolation posture, matching scan's.** No outbound network (`enableInternet = false`). An
unprivileged user. A read-only root filesystem apart from the job spool and the per-worker profile
directories. The per-job directory removed on every exit path, including the crash path. Macro
security at its highest setting in the baked profile, so a converted document can never execute
anything. The platform's default seccomp profile and no-new-privileges, unmodified — this container
needs no capability raster does not.

**The image.** `debian:trixie-slim` runtime.

_Distribution._ The Document Foundation's own Debian package bundle for the **Still** branch,
currently the 25.8 line, fetched at build time, verified by SHA-256, and installed under
`/opt/libreoffice25.8`. Not Debian's `libreoffice-core` package, for a specific reason: Debian's
archive serves only the _current_ version of a package, so pinning `4:25.2.3-2+deb13u6` in a
Dockerfile produces a build that 404s the moment a security update rotates the version — the pin
breaks the reproducibility it was written to provide. A version-addressed upstream archive verified
by hash is the pattern this repository already uses twice, for the scan container's YARA Forge
release and the OCR container's pinned ONNX artifact, and it is the same shape: the build stage has
network access, the runtime stage has none. The `/opt` layout is also exactly what the binding's
`find_opt_latest` expects. Install only what Writer needs — the base bundle plus the Writer
component — skipping Calc, Impress, Draw, Base, the help packs, the software development kit, and
the Java integration entirely (no Java runtime enters the image).

The counterweight is real and should not be glossed: a Debian package carries Debian's security
team, and an upstream bundle carries only The Document Foundation's release cadence. The mitigation
is that the version is a single build argument, the nightly-rebuild pattern the scan container
already runs applies unchanged, and moving the pin is a one-line change plus a golden-file review.

_Fonts._ Carlito and Caladea are the load-bearing pair — they are metric-compatible with Calibri and
Cambria, and without them LibreOffice substitutes Liberation and the layout shifts, which is the
concrete build requirement the research identified. Alongside them: Liberation 2 for the
Arial/Times/Courier metrics, DejaVu Core, Noto Core, and — a judgment call — Noto CJK. Noto CJK adds
roughly a hundred megabytes for documents we will meet only occasionally, but a CJK exhibit rendering
as replacement boxes is a silent correctness failure in a discovery context, and the OCR engine has
already committed us to reading CJK. `fc-cache` runs at build time so no worker pays font-cache
construction at boot.

_Size._ A Writer-only upstream install is roughly 550 to 700 megabytes on disk; the font set adds
about 120 megabytes with Noto CJK; the slim base is about 30 and the Rust binaries about 10. The
final image lands around **750 megabytes to one gigabyte** — an order of magnitude above every other
container in this repository, and the single largest cost this engine introduces. It fits: the image
size limit is the instance's disk, twelve gigabytes on `standard-2`, and the account's total image
storage allowance is fifty gigabytes. The build cost is managed by pruning the unwanted components
inside the same `RUN` as the install (so no intermediate layer carries the deleted bytes), keying the
fetch-and-install layer on the version argument alone so it caches across every other change, and
routing the acceptance build through the existing `containers/docker-build.sh` shim and its external
layer cache.

## Wiring — the exact additive entries

Six files change, all additively.

`apps/worker/src/conversions/conversion-engine.ts` — `CONVERT_WORKER_ENGINE_IDS` gains
`"libreoffice"`. Nothing else in the app worker changes; `resolveEnginePort` already returns the
service-binding port for any engine in that set and already stamps `x-engine-id`. This one-word
change is what actually turns the engine on, which makes it the last step in the deploy sequence
rather than the first.

`apps/convert-worker/src/engine-dispatch.ts` — `EngineTarget` becomes `"raster" | "libreoffice"`,
and `engineTargetFor` returns `"libreoffice"` for the `libreoffice` identifier (and later for
`email`). The existing null-header default to `"raster"` stays, so an app worker deployed ahead of
this one keeps converting images.

`apps/convert-worker/src/libreoffice-engine-container.ts` — a new `LibreOfficeEngineContainer extends
Container` with `defaultPort = 8080`, `requiredPorts = [8080]`, `enableInternet = false`,
`pingEndpoint = "ready"`, and `sleepAfter = "15m"` rather than raster's `"5m"`. The longer idle
window is the direct consequence of the cold start: raster boots in about a second, this container
spends twenty to thirty on LibreOfficeKit initialisation, so scaling to zero too eagerly converts a
cheap idle into an expensive user-visible stall.

`apps/convert-worker/src/index.ts` — `Bindings` gains `LIBREOFFICE_ENGINE`, the class is re-exported
so the runtime can instantiate it, and the single `getContainer(env.RASTER_ENGINE, target)` call
becomes a small target-to-namespace lookup. `forward-convert.ts` is untouched; it is already
engine-agnostic.

`apps/convert-worker/wrangler.jsonc` — a second `containers` entry (`class_name:
"LibreOfficeEngineContainer"`, `image: "../../containers/libreoffice/Dockerfile"`,
`image_build_context: "../../"` because the crate will path-depend on `crates/email-core` at the
email seam, `instance_type: "standard-2"`, its own `max_instances`), a second
`durable_objects.bindings` entry, and a **new** migration tag `{ "tag": "v2", "new_sqlite_classes":
["LibreOfficeEngineContainer"] }`. The `v1` entry is never edited.

`.github/workflows/gate.yml` — `containers/libreoffice` joins the Rust cache path list and the
lockfile list on the dependency-audit step, and the changed-container acceptance case gains
`libreoffice) bash containers/libreoffice/tests/acceptance.sh ;;`. That last one is required, not
optional: a new container directory that appears in neither the acceptance map nor the
explicitly-not-yet-covered list fails the job by design. The repository-root `.dockerignore` already
allowlists `crates/` and `containers/`, so it needs nothing.

**Deploy order, for `docs/deploy-queue.md`.** The convert worker must be redeployed with the new
Container class **before** the app worker starts routing the `libreoffice` identifier. If that order
inverts, `x-engine-id: libreoffice` reaches a convert worker that returns 501, the app worker's
adapter maps it to `adapter-error`, and the job fails cleanly — a degradation, not an outage, which
makes the order a strong preference rather than a hazard. The queue should still carry it, along with
two operational notes: the first Workers Builds run for this container builds a roughly one-gigabyte
image and will take substantially longer than any build in the project so far, and the `conversions/`
R2 lifecycle rule already on the queue covers this engine's outputs too — no new bucket step.

## Test strategy

The split follows the risk, and the risk is almost entirely in the pool rather than in LibreOffice.

**Host-testable, in `cargo test` on any machine — the containers Rust gate.** The recipe-to-filter
mapping and its unknown-recipe rejection; format-pair dispatch and its 415; the package builder and
manifest; the job-directory lifecycle including removal on every failure path; the HTTP status
mapping; and — the substantial part — the supervisor's entire state machine, exercised against a
**fake worker binary**. That fake is a second small `[[bin]]` speaking the same pipe protocol, which
can be instructed to hang, exit non-zero, abort on a signal, grow its resident set, or return
garbage. Against it we test: acquire and release, the acquire deadline and its 503, the conversion
deadline killing exactly one child, replacement after a crash, the conversion-count and
resident-memory recycle triggers, the pre-warmed replacement never showing as latency, and the pool
continuing to serve throughout every one of those. None of it needs LibreOffice, and all of it is the
part most likely to be wrong.

**Docker-gated acceptance — `containers/libreoffice/tests/acceptance.sh`, mapped in `gate.yml`,
built through `docker-build.sh`.** Build the image, boot it, wait for `/ready`, then per format pair
post a committed fixture and assert the result.

Golden files here are **structural, not byte-equal**, because a PDF is not byte-reproducible — the
creation date, the document identifier, and font subset naming all vary per run. So the assertions
are: correct magic bytes and container format; expected page count; expected extracted text, using
`crates/pdf-core`'s existing text extraction rather than a new dependency; and expected embedded font
names, including Carlito and Caladea where the source document asks for Calibri and Cambria. That
last assertion is the one that actually catches the font-substitution regression the research warned
about, and it is worth more than a pixel comparison would be. For `docx→odt`, the assertion is that
the output is a valid OpenDocument archive whose `content.xml` carries the source's paragraphs.

Three behavioural cases join the format matrix, and they are the reason this suite exists at all.
**Concurrency:** two simultaneous conversions must both succeed and both be correct — the precise
thing naive concurrent `soffice --convert-to` fails silently, and therefore the assertion that proves
the pool is doing its job. **Wedge:** a document crafted to hang returns 504, and the very next
request succeeds. **Recycle:** driving the pool past `max_conversions_per_worker` replaces a worker
and keeps serving without a gap.

**Deploy-gated.** The Container binding cannot run under `@cloudflare/vitest-pool-workers`, so the
convert worker's dispatch is tested against a fake container using the existing `forward-convert`
pattern, and the genuine end-to-end is a post-deploy smoke against the real service binding.

**Fixtures.** Small, committed, non-privileged documents, generated once and reviewed. The
WordPerfect fixture is the awkward one — a genuine legacy `.wpd` that we can license and commit is
not trivially sourced, and it is listed as an open question rather than assumed.

## Implementation plan

Seven tasks, ordered so each leaves the branch working.

1. **Container skeleton and image.** `containers/libreoffice/` with the Dockerfile, the pinned
   upstream bundle with SHA-256 verification, the font set and build-time `fc-cache`, and the
   `engine_host` service with an honest `/ready`. One worker child, no pool yet, no dispatch —
   proves the image builds in Workers Builds and the binding loads the suite.
2. **Pool supervisor, worker binary, and pipe protocol.** The two `[[bin]]` targets, the manifest and
   result types, the per-job directory lifecycle, the per-worker profile, and the fake worker binary
   the tests drive.
3. **Health, recycling, deadlines, and crash isolation**, with the full supervisor test suite against
   the fake worker. This is the task that carries the risk; it should be the longest.
4. **Format dispatch and the four edges.** Recipe-to-filter mapping, the format-pair router, status
   mapping, and password-protected and unconvertible handling.
5. **Acceptance suite, fixtures, and `gate.yml` wiring** — including the concurrency, wedge, and
   recycle cases.
6. **Convert-worker and app-worker wiring.** The Container class, the dispatch entry, the
   `wrangler.jsonc` container plus binding plus migration `v2`, then the
   `CONVERT_WORKER_ENGINE_IDS` addition, plus the `docs/deploy-queue.md` note.
7. **Documentation.** `containers/libreoffice/CLAUDE.md`, the operations runbook section, the
   user-facing note that these conversions are live, the status fragment, and the changelog fragment.

The email-to-PDF render engine is a separate cycle that consumes the package seam from task 2 and
adds one dispatch arm; nothing in it reopens this design.

## Risks

**LibreOffice version pinning and upgrade drift.** A minor version bump can change layout, which
means it can change every golden file. This is not a bug to be fixed but a property to be managed: an
upgrade is a deliberate pull request that regenerates the golden files and reviews the diff, never an
incidental consequence of a rebuild. The pin lives in one build argument. The compensating seam is
provenance — `/ready` reports the suite version, and the conversion record can stamp it, so a
document converted before and after an upgrade is explainably different rather than mysteriously so.
That stamping is a registry and orchestration change outside this container, noted as an open
question below.

**Font metrics drift.** A font package upgrade shifts layout as surely as a suite upgrade, and is far
easier to let through unnoticed. Font versions are pinned alongside the suite, and the acceptance
suite's embedded-font-name assertion is what turns an accidental substitution into a red build rather
than a subtly wrong PDF.

**Memory.** LibreOffice's resident set on a pathological document is not bounded by anything we
control. The per-worker ceiling plus recycling is the answer, and it is deliberately per-worker
rather than per-container: without it, the alternative outcome is the platform out-of-memory-killing
the whole instance, taking every in-flight conversion with it. The trade is that a legitimate very
large document may be recycled out from under itself and fail; that is the correct direction to fail
in, and it surfaces as a retryable status rather than a corrupt output.

**Binding abandonment.** Covered above: pinned version, small auditable surface, stable C ABI beneath
it, vendoring as a scoped fallback.

**Image size and build time.** Roughly one gigabyte and minutes per build, against a project where
the next largest container is a small fraction of that. Mitigated by layer-cache keying and component
pruning, but it will be felt in continuous integration on every change to this directory, and the
path filter that limits the containers job to changed containers is what keeps it off everyone else's
builds.

**Silent fidelity failure.** A conversion that succeeds while quietly dropping content is worse than
one that fails, and there is no general oracle for it. The text-extraction assertion in the
acceptance suite catches gross loss and nothing subtler. This is a known limit, and it is a large
part of why the original file is never mutated and the conversion is always written as a new object.

**WordPerfect's long tail.** The writerperfect filters cover WordPerfect 4.2 through 6.x well, and
exotic or damaged files exist beyond that. A failed `wpd→odt` is a deterministic 422, not a crash,
which is the acceptable shape for a best-effort legacy import.

## Open questions

1. **Pool size and instance type are a starting point, not a measurement.** Whether one vCPU makes a
   two-worker pool useful at all — or whether `standard-1` with a larger `max_instances` is the
   better shape — cannot be settled before the load-profile harness sees a real conversion mix.
2. **Whether the conversion record should carry the engine's suite and font-set version.** The
   container is ready to report it and the provenance value is clear, but the record itself belongs
   to the conversion core, so this needs the agreement of that area rather than a decision here.
3. **A licensable, non-privileged legacy `.wpd` fixture.** Needed before the `wpd→odt` acceptance
   case can be more than a smoke test.
4. **`sleepAfter` at fifteen minutes.** It trades idle container cost against a twenty-to-thirty
   second cold start landing on a user-visible conversion. The right value is a function of real
   arrival rates, which do not exist yet.
