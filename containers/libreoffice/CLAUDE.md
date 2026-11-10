# containers/libreoffice — local rules

The office-conversion engine. A Rust supervisor with an axum surface (`GET /ready`, `POST /convert`
on :8080) plus a pool of long-lived worker child processes, each of which loads LibreOffice through a
`dlopen`'d C ABI and converts one document at a time. It serves the four registered office edges —
`docx→pdf`, `odt→pdf`, `docx→odt`, `wpd→odt` — and nothing else.

**Worker side:** `apps/convert-worker/src/libreoffice-engine-container.ts` (the
`LibreOfficeEngineContainer` Durable Object), `apps/convert-worker/src/engine-dispatch.ts`, and
`apps/api-worker/src/conversions/conversion-engine.ts` (the app-worker adapter that reaches this engine
over the `CONVERT` service binding). **Deploy:**
[`docs/conventions/operations.md`](../../docs/conventions/operations.md) and
[`docs/deploy-queue.md`](../../docs/deploy-queue.md).

## Key files

- `src/service.rs` — the axum router. `/ready` is honest (see below); `/convert` reads
  `x-source-format` / `x-target-format` / `x-recipe`, resolves a recipe, materialises a job package,
  calls the pool, and maps the outcome to a status.
- `src/pool.rs` — the supervisor's state machine: spawn and warm, acquire and release, the acquire
  deadline, the conversion deadline and its kill, replacement after a crash, and both recycle
  triggers with a pre-warmed replacement. This is where the risk in this engine lives.
- `src/protocol.rs` — the length-prefixed JSON pipe protocol, in both an async (supervisor) and a
  blocking (worker) codec over one frame format.
- `src/package.rs` — the per-job package directory and its manifest, with a drop guard that removes
  the directory on every exit path.
- `src/dispatch.rs` — the format-pair table and its recipe-to-filter mapping.
- `src/bin/worker.rs` — the only binary that loads LibreOffice.
- `src/bin/fake-worker.rs` — the test double the pool is proved against. Never enters the image.
- `profile/` — the baked user profile each worker starts from.

## Local rules / invariants

- **Never destroy and recreate the suite in a live process.** The binding segfaults if an office
  instance is created after one is destroyed, and it segfaults again if two exist at once. Both facts
  are structural, not stylistic: recycling is **always process replacement**, and one conversion at a
  time per worker is a correctness property. There is no code path here that tears a worker's suite
  down and rebuilds it, and adding one would be a crash, not a refactor.
- **The supervisor holds no suite state.** Everything that touches LibreOffice is a child process.
  That is the whole reason a wedged or segfaulting conversion kills its own child and nothing else,
  and it is what keeps the consented C++ on the far side of a process boundary from anything that
  decides. Do not move suite calls into the supervisor for convenience.
- **`/ready` is honest and must stay honest.** It answers 503 until a worker has reported that suite
  initialisation finished, and 200 with the suite version after. Initialisation takes tens of
  seconds; a container that reported ready sooner would hand that entire delay to the first user
  request as an unexplained stall. This is the one documented divergence from the shared container
  host skeleton: `engine_host::host::ready_app` answers a static 200, which is exactly the lie this
  container must not tell, so `src/service.rs` defines `/ready` itself. Everything else from
  `crates/engine-host` is kept — the panic net, the `0.0.0.0:8080` bind, and an explicit body cap.
- **Never a 200 with empty bytes.** A worker that reports success and writes nothing is a 500, not an
  empty success. A caller about to file something cannot be left unable to distinguish an empty
  document from a failed conversion. The status map is fixed: 415 for a pair this container does not
  serve, 422 for a document that reached the suite and could not be converted (including
  password-protected), 503 for no worker or a dead one, 504 for the conversion deadline.
- **We never attempt a password.** The worker asks to be told about password prompts only so it can
  report `password-protected` distinctly, and always answers "unknown". An encrypted document is a
  deterministic fact — the same stance the scan engine takes — not something to brute-force.
- **Dispatch is on the format pair, never on `x-engine-id`.** That header always arrives, because the
  convert worker forwards headers verbatim, and is deliberately not read. It is what lets the future
  email render engine share this container behind its own engine identifier without this container
  learning that engine identifiers exist.
- **The job unit is a package, not a body.** Each conversion is a directory holding a manifest and
  one or more files, and document bytes never cross the worker pipe — LibreOfficeKit is path-based,
  so the pipe carries only a manifest and a result. The email path later writes `message.html` plus a
  `resources/` subdirectory into the same directory and changes nothing else. Keep it that way.
- **Packages live on disk, never a tmpfs**, specifically so a large document consumes disk budget
  rather than the memory budget the workers are sized against.
- **Memory-safety posture (golden rule 14).** LibreOffice is a large C++ suite that parses
  adversarial, privileged document bytes directly. It is **owner-consented**: no Rust library reads
  DOCX, ODT, and WordPerfect with anything approaching this fidelity, and the partial Rust readers
  that exist would produce conversions a firm cannot file. The consent buys exactly one thing — the
  ability to `dlopen` a shared library at run time — and it does **not** extend to the binding layer.
  Everything we write is Rust: the supervisor, the worker protocol, the HTTP host, and the binding
  itself. `libreofficekit` has no `build.rs`, no `cc`, no `bindgen`, and no `-sys` crate; it
  reimplements the bootstrap in Rust and loads the suite through `dlopen2`. No C++ toolchain enters
  the image build. Any change that pulls a `-sys` crate or a C compiler into this crate is a
  violation, not an optimisation.
- **The binding version is pinned exactly (`=0.5.0`) and `Cargo.lock` is committed.** The crate has
  one maintainer and modest adoption, which is below the bar a load-bearing dependency normally
  clears. Three things make it acceptable: the surface is small and fully auditable (a `dlopen` shim
  plus typed wrappers over a handful of C entry points, not a parser), the interface beneath it is
  the LibreOfficeKit C ABI which The Document Foundation keeps stable, and the fallback is bounded —
  if it goes dark we vendor it into `crates/` and own roughly a thousand lines of foreign-function
  code. An upgrade is a deliberate change, never a range resolution.
- **The suite version pin is a golden-file decision.** A minor version bump can change layout, which
  means it can change every acceptance golden file. Moving `LIBREOFFICE_VERSION` (and its SHA-256) is
  a pull request that regenerates them and reviews the diff, never an incidental consequence of a
  rebuild. `/ready` reports the suite version so a document converted before and after an upgrade is
  explainably different rather than mysteriously so.
- **Font versions are pinned alongside the suite, and the font assertion is the guard.** Carlito and
  Caladea are metric-compatible with Calibri and Cambria; without them the suite substitutes
  Liberation and the layout shifts. The acceptance suite asserts the embedded font names, which is
  what turns an accidental substitution into a red build rather than a subtly wrong PDF.
- **No runtime egress.** The Container runs `enableInternet = false`. Together with the packager's
  rewriting and the baked profile's link-update and remote-content settings, that is three
  independent layers, any one of which would suffice, and none of which depends on the other two
  being correct.
- **The fidelity ceiling is stated, not implied.** LibreOffice's DOCX rendering is very good and is
  not Word: complex numbering, floating-object anchoring, SmartArt, embedded OLE objects, and
  tracked-change display can all differ. What this engine produces is a faithful conversion, not a
  certified reproduction, and the acceptance suite pins _our_ rendering. The original is never
  mutated, which is what makes that acceptable.

## Commands

```
cargo test                                   # the WHOLE Rust suite — runs on any host, no LibreOffice, no Docker
cargo fmt --check && cargo clippy --all-targets -- -D warnings
bash tests/acceptance.sh                     # build the image + drive real conversions (needs Docker + cargo)
python3 tests/fixtures/build-fixtures.py     # regenerate the committed fixtures
```

### Tuning

Every pool number is an environment variable, because every one of them is a defensible starting
point rather than a measurement — they get re-derived against the load-profile harness once there is
a real conversion mix, and that must not need an image rebuild.

| Variable                                              | Default | What it governs                                  |
| ----------------------------------------------------- | ------- | ------------------------------------------------ |
| `MAGNA_CARTA_LIBREOFFICE_POOL_SIZE`                   | 2       | Warm workers held                                |
| `MAGNA_CARTA_LIBREOFFICE_MAX_CONVERSIONS`             | 50      | Conversions before a worker is replaced          |
| `MAGNA_CARTA_LIBREOFFICE_MAX_RESIDENT_KIBIBYTES`      | 1572864 | Resident-set ceiling before a worker is replaced |
| `MAGNA_CARTA_LIBREOFFICE_CONVERSION_DEADLINE_SECONDS` | 120     | Wedged, not slow — the child is killed at this   |
| `MAGNA_CARTA_LIBREOFFICE_ACQUIRE_DEADLINE_SECONDS`    | 30      | Wait for an idle worker before reporting busy    |
| `MAGNA_CARTA_LIBREOFFICE_WARM_DEADLINE_SECONDS`       | 120     | A new worker's initialisation budget             |

The acquire deadline interacts with the recycle policy: when several workers cross their budget at
once, the next request waits out a real suite initialisation. That is why the acceptance suite's
recycle case raises it — it asserts that every request is eventually answered across recycling, not
that it is answered inside the production window.

`cargo test` proves the supervisor's entire state machine against `src/bin/fake-worker.rs`, which can
be told to hang, exit non-zero, abort on a signal, report a runaway resident set, emit a malformed
frame, or produce no output. That is deliberate: the risk in this engine is almost entirely in the
pool rather than in LibreOffice, and the pool must be provable without a four-hundred-megabyte office
suite on the machine.

## Gotchas

- **The bundle ships no `libsofficeapp.so`.** The binding tries that name first and falls back to
  `libmergedlo.so`, which is what the upstream Debian bundle actually carries. Both paths are in the
  crate; nothing here needs to force one.
- **Assert on the inspector's collapsed `text:` line, never on the raw extraction.** PDF text
  extraction preserves the page's line breaks, so a sentence that wraps arrives with a newline inside
  it and a contiguous `grep` fails even though every word survived — which is exactly how the first
  green build was reported red. Where a line wraps is a layout detail that moves with a font or a
  suite version; whether the content survived is what the gate is for, so `inspect-conversion` emits
  a whitespace-collapsed `text:` line and the raw block exists only to be read in a failure log. The
  OpenDocument assertion strips markup and collapses whitespace for the same reason: the writer is
  free to split a paragraph across spans.
- **Each worker's profile is selected through `HOME`, not an argument.** The binding's bootstrap uses
  the single-argument LibreOfficeKit hook, which takes no user-profile URL, so there is no way to
  pass a `UserInstallation`. The supervisor gives each worker its own home directory instead, which
  is how the suite itself resolves the profile. Do not "simplify" that away — a shared profile is
  exactly the lock contention that makes concurrent command-line conversions fail silently.
- **The system library list in the Dockerfile was derived by reading the tree's own ELF
  dependencies, not guessed.** The upstream packages declare no system dependencies, so apt cannot
  resolve them and a wrong package name would surface as a container that boots, never becomes
  ready, and never says why. The build runs `ldd` over the merged library and fails on any
  unresolved dependency; keep that step. Note the trixie names: `libcups2t64` and `libglib2.0-0t64`
  — the un-suffixed names do not exist in trixie.
- **Four plugin libraries are pruned at build time** (the GTK tiled-editing widget, GStreamer media,
  the Java bean, the MySQL connector). Each was the sole reason a whole system library stack would
  otherwise be needed, and none is reachable from a conversion. Removing the prune step means
  reinstating gtk3, gstreamer, and a Java runtime.
- The engine **cannot run under `@cloudflare/vitest-plugin`** (containers unsupported there),
  so the worker binding is a deploy-time activation: the convert worker's dispatch is tested against
  a fake container, and the genuine end-to-end is a post-deploy smoke against the real service
  binding.
- **The image is roughly a gigabyte** — an order of magnitude above every other container here, and
  the single largest cost this engine introduces. It fits (the limit is the instance's disk, twelve
  gigabytes on `standard-2`), but the first Workers Builds run will take substantially longer than
  any build in this project so far.
- **Do not add an acceptance assertion about what the suite does with malformed input.** It was tried
  and removed on evidence, and re-adding it will cost the same round-trips. On one suite version, a
  mislabelled plain-text file **converted and returned 200** (detection falls back to the text
  importer), while a truncated archive **wedged the suite until the 120-second deadline killed it and
  returned 504**; the 422 the design names needs a password-protected document to provoke at all.
  Which of the three a given malformed file earns is LibreOffice's detection and recovery behaviour,
  free to change between versions — so any assertion there measures the suite rather than this
  engine, and spends two minutes of every run doing it. All three status paths are proved
  deterministically against the fake worker instead, in `tests/service.rs` (the 415/422/503/504
  mapping, and that a failure never becomes an empty 200) and `tests/pool.rs` (the deadline kills
  exactly one child and the next request succeeds). The acceptance suite keeps only what genuinely
  needs a real suite: that it converts, that the metric-compatible fonts are substituted, that our
  own dispatch refuses an unserved pair with 415 before a worker is touched, that two conversions run
  at once, and that the pool keeps serving across recycling.
  **The general rule this is an instance of:** the acceptance tier asserts _our_ contract and the
  things only a real suite can demonstrate; it never pins a behaviour LibreOffice is entitled to
  change. If an assertion needs a CI round-trip to discover what it should expect, it is measuring
  the wrong layer.
- **Not yet covered by the acceptance suite, deliberately named rather than left silent:** a real
  `wpd→odt` assertion (a licensable, non-privileged legacy WordPerfect fixture has not been sourced)
  and a real wedge case with a fixture that hangs the suite _reliably_ rather than incidentally.
  Both are fixture-sourcing problems; the dispatch, the status mapping, and the
  deadline-and-recovery machinery are proved by `cargo test`.
