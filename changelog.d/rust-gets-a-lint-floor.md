---
category: Security
audience: internal
---

**Rust gets a lint floor, and `unsafe` is forbidden while the door is still shut.** `vp run rust-check` has always been `cargo fmt --check && cargo clippy -- -D warnings && cargo test`, on clippy's default lint set. There was no `[workspace.lints]` table anywhere, so nothing enforced the property the platform actually rests on: that Rust reading an opposing party's PDF, an unknown sender's `.msg` or a custodian's 7z stays memory-safe and does not abort on bytes it was handed.

`unsafe_code = "forbid"` rather than `deny`, so no crate, module or expression can take it back — the only way to reintroduce unsafe Rust is to edit the table, in a diff somebody reads. The crates workspace is unsafe-free today, which is exactly what makes it free to impose and exactly why now is the moment. `non_ascii_idents` goes the same way: a homoglyph pair reads as one word to a reviewer and is two symbols to the compiler. Two container workspaces do carry `unsafe` (the LibreOfficeKit error callback; two memory maps in the scan spool) and each omits the rule in its own manifest with the site named, so the gap is recorded rather than excused.

Panic-class clippy lints — `unwrap_used`, `panic`, `panic_in_result_fn`, `todo`, `unimplemented`, `mem_forget`, `dbg_macro` — are denied where the tree is already clean of them, and `print_stdout`/`print_stderr`/`exit` in the crates workspace, where every site was an evaluation harness. Those three are deliberately absent from the container tables: a container's binary **is** the process, so a startup diagnostic on stderr and a non-zero exit on a fatal boot failure are correct rather than a smell.

**Every level was measured first,** because the gate runs `-D warnings` and there is no level here that means "tell me later". What stayed out is recorded with its count: `clippy::indexing_slicing` at **361 sites**, clean in exactly one member so there is nothing to scope it to — the headline burn-down — and `clippy::arithmetic_side_effects` at **416**, whose real home is the byte-offset arithmetic derived from file headers. `clippy::expect_used` is four library sites away from landing.

Six source lines changed rather than watering a rule down: without them, `recovery-core` and `pdf-core` — the two crates the unwrap rule matters most for — would each have needed a crate-wide allow and lost it entirely. Test code is exempted through `clippy.toml` instead of attributes scattered through the suites.

Also fixed while in the area: the gate's cargo cache listed eight container workspaces and there are nine. `containers/discovery` rebuilt its whole dependency graph from cold on every run, silently, and that list is hand-written so nothing said so.
