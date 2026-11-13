/*
 * The consent register for native and memory-unsafe dependencies, and the detectors that check the
 * tree against it. The runner is index.mjs; every decision here is a pure function over text so it
 * can be unit-tested without a repository or an install.
 *
 * WHY THIS EXISTS. The fourteenth golden rule says a C or C++ dependency — including a transitive
 * native library and C compiled to WebAssembly — arrives only with explicit owner consent, and that
 * one which is already here or newly proposed must be SURFACED and asked about rather than adopted
 * silently. Nothing enforced any of that. A transitive `*-sys` crate or an npm package with an
 * install script could land in a lockfile bump and nobody would see it.
 *
 * WHAT THIS CAN SEE, stated plainly, because the value of a consent gate is exactly its honesty:
 *
 *   IT CAN SEE — and fails on an unregistered arrival:
 *     * pnpm-workspace.yaml's `onlyBuiltDependencies`. That list IS the set of packages permitted
 *       to run a native build script on install, so it is the one place a native build is granted
 *       by name. Every entry must carry a reason here; an unexplained addition fails.
 *     * Packages pnpm BLOCKED from running a build script, read from node_modules/.modules.yaml
 *       (`ignoredBuilds` / `pendingBuilds`). This is how a newly-arrived build script announces
 *       itself: pnpm 10 blocks it by default and records the name.
 *     * Prebuilt platform binaries in pnpm-lock.yaml — a package constrained by `cpu:` or `os:` is
 *       shipping a compiled artefact rather than JavaScript. Collapsed to a family (the whole
 *       `@esbuild/*` set is one entry), because the decision is about the tool, not the platform.
 *     * Every tracked Cargo.lock: a crate whose name ends in `-sys`, or which depends on `cc`,
 *       `cmake`, `bindgen` or `pkg-config`. That is the Cargo-side signature of compiling or
 *       linking C or C++.
 *
 *   IT CANNOT SEE, and no amount of parsing would change it:
 *     * Whether a build script actually compiles C. `onlyBuiltDependencies` grants the right to run
 *       a script; the script's contents are not read here, and a Rust or Go toolchain download uses
 *       the same mechanism as a node-gyp build.
 *     * A third-party npm package's install script BEFORE an install has run. pnpm's lockfile
 *       format carries no `requiresBuild` field, so that half of the check needs node_modules and
 *       degrades to a printed notice without it rather than passing silently.
 *     * Which crates a build actually COMPILES. Cargo.lock records the resolved graph, not the
 *       feature-and-target-selected subset, so a target-gated crate (the Haiku time-zone shim, the
 *       Apple framework declarations) is listed here even though no build here reaches it. That is
 *       deliberate over-inclusion: the register says so per entry.
 *     * Anything vendored. A C source tree committed into a crate or copied into a container image
 *       has no lockfile entry and no build script. Review is the answer to that one.
 *     * What a container image installs with apt, or unpacks from a vendor archive. There is no
 *       lockfile to read, and a per-package gate over those lines would be noise: the LibreOffice
 *       image alone installs about thirty shared libraries that are all one decision. Those engines
 *       are RECORDED in SYSTEM_ENGINES and printed with everything else — the surfacing half of the
 *       rule without pretending to the enforcement half. The container gate
 *       (tooling/lint-containers) gates those Dockerfiles on different properties.
 *
 * THE STATUSES, and what each one means for the gate's exit code:
 *
 *   memory-safe      Not a C or C++ dependency at all. Rust, Go, TypeScript, or a crate that only
 *                    DECLARES a platform ABI without compiling any C. Silent.
 *   consented        C or C++, with the owner's consent already on record in the repository.
 *                    Printed on every run so the consented set stays visible. Does not fail.
 *   surfaced         C or C++, present in the tree, NOT yet ruled on. Golden rule 14 asks for these
 *                    to be surfaced rather than adopted silently, and this is the surfacing:
 *                    printed loudly on every run, and it does not fail the gate, because failing on
 *                    what is already here would only get the gate switched off.
 *   pending-removal  A grant with nothing behind it — a permission that outlived its consumer.
 *                    Printed loudly. Removing it is the owner's call, not this gate's.
 *   blocked          A build script pnpm refuses to run, recorded so it stays refused. If it ever
 *                    moves onto the granted list, that is an unexplained addition and fails.
 *
 * An arrival that matches NO entry fails the gate. That is the whole mechanism: what is here is
 * written down, and what is new has to be written down before it can land.
 *
 * Run: `pnpm run lint:native-builds`. Node builtins only; no install, no build, no network.
 */

/* ---------------------------------------------------------------------------------------------
 * The register.
 * ------------------------------------------------------------------------------------------- */

/**
 * pnpm-workspace.yaml's `onlyBuiltDependencies` — the packages permitted to run a build script on
 * install. This is the audited allowlist: the workspace file holds the names, this holds the
 * reasons, and the two must agree exactly.
 */
export const BUILD_SCRIPT_GRANTS = new Map([
  [
    "workerd",
    {
      status: "memory-safe",
      language: "C++ (the runtime), consumed as a prebuilt binary",
      reason:
        "The Cloudflare Workers runtime. It ships as a platform-specific prebuilt binary through " +
        "@cloudflare/workerd-<platform>; the granted script is the wrapper postinstall that " +
        "selects one, not a compile. It is the runtime this platform deploys onto, so it is not a " +
        "dependency choice that could be made differently",
    },
  ],
  [
    "esbuild",
    {
      status: "memory-safe",
      language: "Go",
      reason:
        "The bundler, written in Go and shipped as a prebuilt binary per platform. The granted " +
        "script selects the binary. No C or C++ is compiled or linked",
    },
  ],
  [
    "sharp",
    {
      status: "surfaced",
      language: "C (libvips)",
      reason:
        "libvips, a large C image-processing library, and the one C library the npm graph installs " +
        "on the Linux path. It is NOT first-party: nothing here imports it and raster conversion is " +
        "the pure-Rust `image` crate in the raster container, which was the deliberate choice " +
        "against native libvips. It arrives under miniflare, and so under wrangler and the Workers " +
        "test pool, which every worker package carries as a development dependency (`pnpm -r why " +
        "sharp` shows the path). The grant is therefore load-bearing — removing it does not remove " +
        "the library, it only stops the install selecting its prebuilt binary — and the honest " +
        "reading is that the platform vendor's toolchain decides this one, not us. It runs at " +
        "install time on a developer machine and in the build, never in a Worker at runtime, and it " +
        "never sees a firm's bytes",
    },
  ],
]);

/**
 * Packages pnpm has BLOCKED from running a build script, and packages whose build is pending.
 * Recorded so the refusal is a decision rather than an accident.
 */
export const BLOCKED_BUILD_SCRIPTS = new Map([
  [
    "@scarf/scarf",
    {
      status: "blocked",
      language: "JavaScript",
      reason:
        "A telemetry package whose postinstall reports an installation to a vendor endpoint. It " +
        "compiles nothing; pnpm blocks it because it has an install script, and it stays blocked " +
        "because this repository sends no dependency metadata off its own compute. Do not move it " +
        "onto onlyBuiltDependencies",
    },
  ],
]);

/**
 * C and C++ that enters through a container image's system packages rather than through a lockfile.
 *
 * RECORDED, NOT DETECTED — and the distinction is the point. Nothing here is checked against the
 * tree: the detectors below read lockfiles, and a `apt-get install` line has no lockfile. A
 * per-package gate over those lines was considered and left out because it would be noise rather
 * than signal: the LibreOffice image alone installs about thirty shared libraries that are one
 * decision (LibreOffice runs in a container), and a gate that failed on each of them separately
 * would be switched off long before it caught anything. So this table exists for the SURFACING half
 * of golden rule 14, not the enforcement half, and it says so rather than implying coverage it
 * does not have. What does gate these images is the container gate (tooling/lint-containers), on
 * different properties: base pinning, root, downloads, secrets in layers.
 */
export const SYSTEM_ENGINES = new Map([
  [
    "clamav / clamd (containers/scan)",
    {
      status: "consented",
      language: "C",
      reason:
        "THE consented exception. The repository's own standing rule names it: a C engine that is " +
        "genuinely unavoidable, consented, contained in a network-isolated sandbox, and " +
        "documented. It is the long-lived daemon in the scan image, scanning untrusted bytes with " +
        "no egress, ephemeral per job and resource-capped",
    },
  ],
  [
    "LibreOffice (containers/libreoffice)",
    {
      status: "surfaced",
      language: "C++",
      reason:
        "The conversion engine, installed from the vendor's release archive against a pinned " +
        "SHA-256, plus its runtime shared-library closure (fontconfig, cairo, X11, NSS and about " +
        "thirty more). It is the canonical malformed-input parser risk, which is why it runs " +
        "under the sandbox rules and as the one non-root container user in the tree",
    },
  ],
  [
    "Collabora Online / coolwsd (containers/collabora)",
    {
      status: "surfaced",
      language: "C++",
      reason:
        "The collaborative editor, taken whole as a vendor image. Same engine family as the " +
        "LibreOffice container and the same containment",
    },
  ],
]);

/**
 * Prebuilt platform binaries in the npm graph, collapsed to one entry per tool. A package
 * constrained by `cpu:` or `os:` ships a compiled artefact; what matters is which tool it belongs
 * to, not which of its nineteen platform variants the lockfile happens to carry.
 */
export const NATIVE_BINARY_FAMILIES = new Map([
  [
    "@cloudflare/workerd",
    { status: "memory-safe", language: "C++, prebuilt", reason: "The Workers runtime binary" },
  ],
  ["@esbuild", { status: "memory-safe", language: "Go, prebuilt", reason: "The esbuild binary" }],
  [
    "@oxc-parser/binding",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The Oxc parser used by Vite+" },
  ],
  [
    "@oxc-resolver/binding",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The Oxc module resolver" },
  ],
  [
    "@oxfmt/binding",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The Oxfmt formatter" },
  ],
  [
    "@oxlint/binding",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The Oxlint linter" },
  ],
  [
    "@oxlint-tsgolint",
    {
      status: "memory-safe",
      language: "Go, prebuilt",
      reason: "The type-aware lint pass, a Go port of the TypeScript checker",
    },
  ],
  [
    "@rolldown/binding",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The Rolldown bundler in Vite+" },
  ],
  [
    "@tailwindcss/oxide",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The Tailwind v4 engine" },
  ],
  [
    "@voidzero-dev/vite-plus",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The Vite+ toolchain binary" },
  ],
  [
    "lightningcss",
    { status: "memory-safe", language: "Rust, prebuilt", reason: "The CSS transformer Vite uses" },
  ],
  [
    "@yuku-core/binding",
    {
      status: "surfaced",
      language: "Zig, prebuilt",
      reason:
        "The per-platform native core of the Yuku JavaScript parser, which Vite+ 1.5's core pulls " +
        "in through yuku-parser. Zig is not C or C++, but it is not memory-safe either, so it is " +
        "surfaced for the owner rather than filed as memory-safe. It runs at build and dev time " +
        "over this repository's own source and never ships to production",
    },
  ],
  [
    "fsevents",
    {
      status: "surfaced",
      language: "C",
      reason:
        "A small C addon over the macOS file-system events API, pulled in by the watcher as an " +
        "optional macOS-only dependency. It is never installed on the Linux build and deploy path " +
        "and never reaches production; it is recorded because it is the one C addon in the npm " +
        "graph and golden rule 14 asks for that to be visible rather than assumed harmless",
    },
  ],
  [
    "@img/sharp",
    {
      status: "surfaced",
      language: "C (libvips)",
      reason:
        "The per-platform prebuilt binaries sharp selects at install. They are in the lockfile " +
        "because miniflare depends on sharp — see the sharp entry in BUILD_SCRIPT_GRANTS for the " +
        "path and why the grant stands",
    },
  ],
  [
    "@img/sharp-libvips",
    {
      status: "surfaced",
      language: "C (libvips)",
      reason:
        "The bundled libvips shared libraries themselves, shipped precompiled under sharp. Nothing " +
        "compiles them here; they arrive with the platform vendor's toolchain. See the sharp entry " +
        "in BUILD_SCRIPT_GRANTS",
    },
  ],
]);

/**
 * Crates whose name ends in `-sys`, or which build with `cc`/`cmake`/`bindgen`/`pkg-config`. The
 * detector over-includes on purpose (Cargo.lock records the resolved graph, not the target- and
 * feature-selected subset), so each entry says whether a build here actually reaches it.
 */
export const NATIVE_CRATES = new Map([
  [
    "js-sys",
    {
      status: "memory-safe",
      language: "Rust",
      reason: "Declarations of the JavaScript standard library for wasm-bindgen. No C",
    },
  ],
  [
    "web-sys",
    {
      status: "memory-safe",
      language: "Rust",
      reason: "Generated declarations of browser APIs for wasm-bindgen. No C",
    },
  ],
  [
    "windows-sys",
    {
      status: "memory-safe",
      language: "Rust",
      reason:
        "Declarations of the Windows API generated from Microsoft's own metadata, linked against " +
        "the operating system's libraries. No C source is compiled, and no container target is " +
        "Windows",
    },
  ],
  [
    "linux-raw-sys",
    {
      status: "memory-safe",
      language: "Rust",
      reason:
        "Type and constant declarations for the Linux system-call interface. rustix uses them to " +
        "make raw syscalls WITHOUT libc. No C source is compiled",
    },
  ],
  [
    "core-foundation-sys",
    {
      status: "memory-safe",
      language: "Rust",
      reason:
        "Declarations of Apple's Core Foundation, linked at run time on macOS only. No C source " +
        "is compiled, and every deployed target here is Linux",
    },
  ],
  [
    "security-framework-sys",
    {
      status: "memory-safe",
      language: "Rust",
      reason:
        "Declarations of Apple's Security framework, used for the macOS trust store. macOS only; " +
        "no C source is compiled",
    },
  ],
  [
    "iana-time-zone-haiku",
    {
      status: "memory-safe",
      language: "C++ shim, unreachable",
      reason:
        "A four-line C++ shim that reads the time zone on Haiku. It is target-gated to Haiku, " +
        "which nothing here builds for, so the `cc` build-dependency is never invoked. Resolved " +
        "into the graph by chrono regardless of target, which is why it appears at all",
    },
  ],
  [
    "libfuzzer-sys",
    {
      status: "surfaced",
      language: "C++ (LLVM libFuzzer)",
      reason:
        "Links LLVM's libFuzzer runtime, and is reached only under `cargo fuzz` — never by a " +
        "build, a test run or a deploy. It is fuzzing harness machinery for the parsers, which is " +
        "itself a defence against the malformed-input class this platform cares about",
    },
  ],
  [
    "minicov",
    {
      status: "surfaced",
      language: "C (coverage shim)",
      reason:
        "A small C shim that collects LLVM coverage counters, pulled in by wasm-bindgen-test. " +
        "Test tooling for the WebAssembly crates; never in a shipped artefact",
    },
  ],
  [
    "crabgrind",
    {
      status: "surfaced",
      language: "C (Valgrind client-request bindings)",
      reason:
        "In the lock through mls-core: openmls_rust_crypto -> hpke-rs -> libcrux-sha3 -> " +
        "libcrux-traits -> libcrux-secrets, which depends on it only under " +
        "`cfg(valgrind_ct_test)`, a configuration flag for running libcrux's constant-time tests " +
        "under Valgrind that nothing here sets. Never compiled by a build, a test run or a deploy: " +
        "`cargo tree -p mls-core -i crabgrind` is empty for the host and for wasm32",
    },
  ],
  [
    "clang-sys",
    {
      status: "surfaced",
      language: "C (libclang bindings)",
      reason:
        "bindgen's binding to libclang, in the lock only as crabgrind's build dependency, so it " +
        "is reached exactly when crabgrind is: never, here. See the crabgrind entry",
    },
  ],
  [
    "ring",
    {
      status: "surfaced",
      language: "C and assembly (BoringSSL-derived)",
      reason:
        "The cryptographic core under rustls, reached through quinn-proto and rustls-webpki. It " +
        "compiles BoringSSL-derived C and per-architecture assembly. It is the default TLS stack " +
        "of the Rust ecosystem and the alternative (aws-lc-rs) is also C; the memory-safe option " +
        "would be rustls with the pure-Rust provider, which is a real but separate decision",
    },
  ],
  [
    "openssl-sys",
    {
      status: "surfaced",
      language: "C (OpenSSL)",
      reason:
        "Links the system OpenSSL. It is reached only through ureq's native-tls feature, which is " +
        "a DEFAULT-FEATURE tail rather than a deliberate choice — the containers speak plain HTTP " +
        "to an intercepted internal host or use rustls. This is the entry most likely to be " +
        "removable outright, by turning off default features on that dependency",
    },
  ],
  [
    "zstd-sys",
    {
      status: "surfaced",
      language: "C (the Zstandard reference library)",
      reason:
        "Compiled by zstd-safe under Tantivy, which uses Zstandard to compress index segments in " +
        "the search container. The corpus it decompresses is the firm's own index, not " +
        "attacker-supplied bytes, which is a materially lower exposure than a document parser",
    },
  ],
  [
    "onig_sys",
    {
      status: "surfaced",
      language: "C (Oniguruma)",
      reason:
        "The Oniguruma regular-expression engine, compiled by the `onig` crate under `tokenizers` " +
        "in the OCR stack. It parses tokenizer patterns that ship with the model, not untrusted " +
        "input — but it is a C regex engine inside the OCR container's job path",
    },
  ],
  [
    "ort-sys",
    {
      status: "surfaced",
      language: "C++ (ONNX Runtime)",
      reason:
        "ONNX Runtime, linked by `ort`. Two consumers: the OCR container's recognition models and " +
        "the scan container's Magika file-type identifier. Both run inside the no-egress, " +
        "ephemeral, resource-capped Container sandbox that the untrusted-file rules require, which " +
        "is the containment this depends on",
    },
  ],
  [
    "vectorscan-rs-sys",
    {
      status: "surfaced",
      language: "C++ (Vectorscan)",
      reason:
        "Vectorscan, the Hyperscan fork, built by cmake as the scan container's multi-pattern " +
        "prefilter. It sits in the same image as the consented clamd and behind the same sandbox",
    },
  ],
  [
    "cmake",
    {
      status: "memory-safe",
      language: "Rust (it invokes cmake)",
      reason:
        "A build-dependency crate that shells out to cmake. It compiles nothing itself; it is " +
        "here because vectorscan-rs-sys uses it, and that entry is where the decision lives",
    },
  ],
  [
    "wasmtime",
    {
      status: "surfaced",
      language: "Rust, with small C shims",
      reason:
        "The WebAssembly runtime under yara-x in the scan container. Overwhelmingly Rust; the `cc` " +
        "build-dependency builds small platform shims for stack switching and unwinding",
    },
  ],
  [
    "wasmtime-internal-fiber",
    {
      status: "surfaced",
      language: "Rust, with a C assembly shim",
      reason:
        "The stack-switching half of wasmtime, split into its own crate: a small per-architecture " +
        "assembly routine built by `cc`. It arrives with wasmtime and the decision lives on that " +
        "entry, not here",
    },
  ],
  [
    "wasmtime-internal-jit-debug",
    {
      status: "surfaced",
      language: "Rust, with a C shim",
      reason:
        "The half of wasmtime that registers compiled code with a native debugger, split into its " +
        "own crate: a small C shim built by `cc`. It arrives with wasmtime and the decision lives " +
        "on that entry, not here",
    },
  ],
]);

/* ---------------------------------------------------------------------------------------------
 * Detectors.
 * ------------------------------------------------------------------------------------------- */

/**
 * Read `onlyBuiltDependencies` out of pnpm-workspace.yaml. A hand parse rather than a YAML library
 * because this tool takes no dependencies: the block is a top-level key followed by a plain
 * sequence of scalars, which is the one YAML shape worth hand-reading.
 */
export function readBuildScriptGrants(source) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^onlyBuiltDependencies:[ \t]*$/.test(line));
  if (start === -1) return null;
  const granted = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[ \t]*(#|$)/.test(line)) continue;
    const item = /^[ \t]+-[ \t]+(?:["']?)([^"'#\s]+)/.exec(line);
    if (!item) break;
    granted.push(item[1]);
  }
  return granted;
}

/** Tokens that name a platform rather than a tool. Used to collapse `@esbuild/*` into `@esbuild`. */
const PLATFORM_TOKENS = new Set([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "linux",
  "linuxmusl",
  "netbsd",
  "openbsd",
  "openharmony",
  "sunos",
  "win",
  "win32",
  "windows",
  "wasm",
  "wasm32",
  "wasi",
  "webcontainers",
  "browser",
  "universal",
  "arm",
  "arm64",
  "armv7",
  "x64",
  "x86",
  "ia32",
  "32",
  "64",
  "ppc64",
  "ppc64le",
  "riscv64",
  "s390x",
  "mips64el",
  "loong64",
  "musl",
  "gnu",
  "gnueabihf",
  "musleabihf",
  "eabi",
  "msvc",
  "glibc",
]);

/**
 * Collapse a platform-specific package name to the tool it belongs to. `@esbuild/linux-x64` and
 * `@esbuild/win32-arm64` are one decision, not thirty; `@img/sharp-linux-x64` collapses to
 * `@img/sharp`, and a name with no platform tokens is its own family.
 */
export function familyOf(packageName) {
  const scoped = packageName.startsWith("@");
  const slash = packageName.indexOf("/");
  const scope = scoped && slash !== -1 ? packageName.slice(0, slash) : null;
  const rest = scope === null ? packageName : packageName.slice(slash + 1);
  const tokens = rest.split("-");
  while (tokens.length > 0 && PLATFORM_TOKENS.has(tokens.at(-1).toLowerCase())) tokens.pop();
  if (tokens.length === 0) return scope ?? packageName;
  const base = tokens.join("-");
  return scope === null ? base : `${scope}/${base}`;
}

/**
 * Packages in pnpm-lock.yaml that declare a `cpu:` or `os:` constraint — the lockfile's marker for
 * a package shipping a compiled artefact rather than JavaScript. Returns unique family names.
 */
export function readNativeBinaryFamilies(lockfile) {
  const afterPackages = lockfile.split(/(?:^|\n)packages:\n/)[1];
  if (afterPackages === undefined) return null;
  const section = afterPackages.split(/(?:^|\n)snapshots:\n/)[0];
  const families = new Set();
  for (const block of section.split(/\n {2}(?=[^ ])/)) {
    if (!/\n\s+(?:cpu|os):/.test(block)) continue;
    const header = block.trim().split("\n")[0];
    const name = header.replace(/:$/, "").replace(/^['"]|['"]$/g, "");
    // Strip the trailing @version, keeping the leading @ of a scope.
    const at = name.lastIndexOf("@");
    families.add(familyOf(at > 0 ? name.slice(0, at) : name));
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

const CARGO_BUILD_TOOLS = new Set(["cc", "cmake", "bindgen", "pkg-config"]);

/**
 * Crates in a Cargo.lock that either end in `-sys` or depend on a C/C++ build tool. Cargo.lock does
 * not separate build-dependencies from ordinary ones, so this is a superset — which is the right
 * direction for a gate whose job is to notice arrivals.
 */
export function readNativeCrates(lockfile) {
  const found = new Set();
  for (const block of lockfile.split(/(?:^|\n)\[\[package\]\]\n/)) {
    const name = /^name = "(.+)"/m.exec(block)?.[1];
    if (!name) continue;
    const dependencies = (/\ndependencies = \[([^\]]*)\]/.exec(block)?.[1] ?? "")
      .match(/"[^"]+"/g)
      ?.map((entry) => entry.slice(1, -1).split(" ")[0]);
    const buildsNative = dependencies?.some((dependency) => CARGO_BUILD_TOOLS.has(dependency));
    if (name.endsWith("-sys") || buildsNative) found.add(name);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/* ---------------------------------------------------------------------------------------------
 * Judgement.
 * ------------------------------------------------------------------------------------------- */

/**
 * Compare what is in the tree against what is registered. `where` names the surface for the message
 * (a path, or the file the names came from); `register` is the matching table above.
 */
export function judge(where, present, register, hint) {
  const problems = [];
  for (const name of present) {
    if (register.has(name)) continue;
    problems.push({
      kind: "unregistered",
      where,
      name,
      fix: hint(name),
    });
  }
  return problems;
}

export function grantProblems(granted) {
  const problems = [];
  for (const name of granted) {
    if (BUILD_SCRIPT_GRANTS.has(name)) continue;
    problems.push({
      kind: "unregistered",
      where: "pnpm-workspace.yaml",
      name,
      fix:
        `\`${name}\` was added to onlyBuiltDependencies, which grants it the right to run a build ` +
        "script on install. Add it to BUILD_SCRIPT_GRANTS in tooling/lint-native-builds/" +
        "register.mjs with what it builds and in which language. If it compiles C or C++, golden " +
        "rule 14 wants the owner's explicit consent before it lands, not after.",
    });
  }
  for (const [name, entry] of BUILD_SCRIPT_GRANTS) {
    if (granted.includes(name)) continue;
    if (entry.status === "pending-removal") continue;
    problems.push({
      kind: "stale",
      where: "tooling/lint-native-builds/register.mjs",
      name,
      fix:
        `\`${name}\` is registered here but is no longer in pnpm-workspace.yaml's ` +
        "onlyBuiltDependencies. Delete its BUILD_SCRIPT_GRANTS entry — a register that describes " +
        "grants that no longer exist stops being read as a description of the real ones.",
    });
  }
  return problems;
}

/** Entries the run should print loudly: the C/C++ that is here, and the grants with nothing behind them. */
export function standingNotices() {
  const notices = [];
  for (const [table, entries] of [
    ["system engine", SYSTEM_ENGINES],
    ["build-script grant", BUILD_SCRIPT_GRANTS],
    ["blocked build script", BLOCKED_BUILD_SCRIPTS],
    ["npm native binary", NATIVE_BINARY_FAMILIES],
    ["crate", NATIVE_CRATES],
  ]) {
    for (const [name, entry] of entries) {
      if (entry.status === "memory-safe") continue;
      notices.push({ table, name, ...entry });
    }
  }
  return notices;
}

/* ---------------------------------------------------------------------------------------------
 * Self-test samples. Each detector is exercised on every invocation against text that does not
 * depend on the repository, so a parser regression fails loudly rather than reporting an empty tree
 * as clean — which is the one failure mode a consent gate must never have.
 * ------------------------------------------------------------------------------------------- */

/**
 * The detectors are exercised on every invocation against samples that do not depend on the
 * repository, so a parser regression fails loudly rather than reporting an empty tree as clean.
 */
export const SELF_TEST = [
  {
    label: "the grant list is read out of the workspace file",
    run: () =>
      readBuildScriptGrants(
        'packages:\n  - "apps/*"\n\n# a comment\nonlyBuiltDependencies:\n  - workerd\n  - esbuild\n\ncatalog:\n  zod: 4.4.3\n',
      ),
    expect: ["workerd", "esbuild"],
  },
  {
    label: "a missing grant list is distinguishable from an empty one",
    run: () => readBuildScriptGrants('packages:\n  - "apps/*"\n'),
    expect: null,
  },
  {
    label: "platform packages collapse to the tool they belong to",
    run: () =>
      [
        "@esbuild/linux-x64",
        "@esbuild/win32-arm64",
        "@img/sharp-linuxmusl-arm64",
        "@img/sharp-libvips-linux-x64",
        "@oxc-parser/binding-linux-x64-gnu",
        "@cloudflare/workerd-darwin-64",
        "lightningcss-linux-arm64-musl",
        "fsevents",
      ].map(familyOf),
    expect: [
      "@esbuild",
      "@esbuild",
      "@img/sharp",
      "@img/sharp-libvips",
      "@oxc-parser/binding",
      "@cloudflare/workerd",
      "lightningcss",
      "fsevents",
    ],
  },
  {
    label: "a platform-constrained lockfile package is found, an ordinary one is not",
    run: () =>
      readNativeBinaryFamilies(
        [
          "lockfileVersion: '9.0'",
          "",
          "packages:",
          "",
          "  '@esbuild/linux-x64@0.28.2':",
          "    resolution: {integrity: sha512-aaaa}",
          "    engines: {node: '>=18'}",
          "    cpu: [x64]",
          "    os: [linux]",
          "",
          "  zod@4.4.3:",
          "    resolution: {integrity: sha512-bbbb}",
          "",
          "snapshots:",
          "",
          "  zod@4.4.3: {}",
          "",
        ].join("\n"),
      ),
    expect: ["@esbuild"],
  },
  {
    label: "a -sys crate and a cc-building crate are found, a pure Rust one is not",
    run: () =>
      readNativeCrates(
        [
          "[[package]]",
          'name = "zstd-sys"',
          'version = "2.0.0"',
          "",
          "[[package]]",
          'name = "ring"',
          'version = "0.17.0"',
          'dependencies = [\n "cc",\n "getrandom",\n]',
          "",
          "[[package]]",
          'name = "serde"',
          'version = "1.0.0"',
          "",
        ].join("\n"),
      ),
    expect: ["ring", "zstd-sys"],
  },
  {
    label: "a grant that carries a reason here is accepted",
    run: () => grantProblems(["workerd", "esbuild", "sharp"]).map((one) => one.name),
    expect: [],
  },
  {
    label: "an unexplained addition to the grant list is refused",
    run: () => grantProblems(["workerd", "esbuild", "sharp", "canvas"]).map((one) => one.kind),
    expect: ["unregistered"],
  },
  {
    label: "a registered grant that leaves the workspace file is refused as stale",
    run: () => grantProblems(["esbuild", "sharp"]).map((one) => `${one.kind}:${one.name}`),
    expect: ["stale:workerd"],
  },
  {
    label: "a grant that leaves the workspace file while still registered is named, once",
    run: () => grantProblems(["workerd", "esbuild"]).map((one) => `${one.kind}:${one.name}`),
    expect: ["stale:sharp"],
  },
  {
    label: "a registered crate passes and an unregistered one does not",
    run: () =>
      judge("Cargo.lock", ["ring", "brotli-sys"], NATIVE_CRATES, () => "").map((one) => one.name),
    expect: ["brotli-sys"],
  },
];
