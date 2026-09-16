# Rust conventions

**Status:** The **lint floor** below is active and enforced. The rest is a stub, to be written as the Tauri shell and the desktop side land.

**Scope (single home for):** Rust-specific style, tooling, and idioms. Shared cross-language principles live in [`code-style.md`](code-style.md); don't repeat them here.

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Delivery model_ (Rust scope: Tauri shell, Tantivy, the shared document/discovery core compiled to **WASM** for web + **native** for desktop, native Rust in Containers for heavy work).

## The lint floor (active)

Almost all of this Rust reads bytes somebody else chose — a PDF from an opposing party, a `.msg` from an unknown sender, a 7z a custodian handed over — on behalf of a firm that is answerable for whatever comes out. Two failure modes are worth a build gate on that, and the floor is aimed at exactly those two rather than at style:

- a **memory-safety hole**, which is remote code execution over privileged material, and
- a **panic**, which is a denial of service on one firm's document.

The tables live in `crates/Cargo.toml` (`[workspace.lints]`) and in each container workspace's own manifest, because a container is its own Cargo workspace and the crates-scoped gate never reaches it. **A workspace lint table does nothing until each member opts in** with `[lints] workspace = true`; a member that forgets is silently unprotected, which is the one way this floor can quietly stop existing.

- **`unsafe_code = "forbid"`, not `deny`.** `forbid` cannot be taken back by an `#[allow]` on a crate, a module or an expression, so the only way to reintroduce unsafe Rust is to edit the table, in a diff a reviewer reads. The crates workspace is unsafe-free, which is what made this free to impose. Two container workspaces are not — `libreoffice` (the LibreOfficeKit error callback) and `scan` (two `Mmap::map` sites) — and each omits the rule in its own manifest with the site named, so the gap is recorded rather than excused.
- **`non_ascii_idents = "forbid"`** goes the same way: a homoglyph pair reads as one word to a reviewer and is two symbols to the compiler.
- **Panic-class clippy lints are denied where the workspace is already clean of them** — `unwrap_used`, `panic`, `panic_in_result_fn`, `todo`, `unimplemented`, `mem_forget`, `dbg_macro` — plus `print_stdout` / `print_stderr` / `exit` in the crates workspace, where every site was in an evaluation harness. Those three are deliberately absent from the container tables: a container's binary **is** the process, so a startup diagnostic on stderr and a non-zero exit on a fatal boot failure are correct.
- **Test code is exempted through `clippy.toml`** (`allow-unwrap-in-tests` and its siblings), one file per workspace tree, rather than attributes scattered through the suites. That exemption reaches `#[test]` functions and `#[cfg(test)]` modules; it does **not** reach a plain helper in a `tests/*.rs` file, which is compiled as ordinary code, so those few carry a file-level allow that says why.

**Every level was measured before it was chosen.** The gate command is `cargo clippy --all-targets -- -D warnings`, so in CI a `warn` is a red build exactly like a `deny` — there is no level here that means "tell me later". A lint is denied only where the tree is already clean of it, scoped away from the members that are not, or left out entirely with its count recorded in the register at the end of the `crates/Cargo.toml` block. The two worth knowing: **`clippy::indexing_slicing`, 361 sites** (clean in exactly one member, so there is nothing to scope it to — the headline burn-down), and **`clippy::arithmetic_side_effects`, 416 sites**, whose real home is the byte-offset arithmetic derived from file headers.

**To document:**

- rustfmt settings; the remaining clippy bar beyond the floor above.
- Error handling: `Result` everywhere; `thiserror` for libraries, `anyhow` (or equivalent) for binaries; no `unwrap()` on fallible paths outside tests.
- **WASM vs. native** discipline: keep the shared core target-agnostic; isolate platform-specific code behind features/modules so web and desktop behave identically.
- Crate/workspace layout for the shared core, Tauri shell, and Container services.
- FFI / WASM-binding conventions (how TS calls into the WASM core).
- Tantivy and Tauri integration patterns and gotchas.
- When hot-path TS logic is promoted to Rust→WASM (only on profiling evidence — see the white paper's _Delivery model_).
