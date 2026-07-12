### Fixed

- Pin the Rust toolchain (`rust-toolchain.toml`, 1.97.0) so every machine compiles and formats
  identically. An older stable could not build the workspace at all (`oar-ocr` requires rustc 1.95
  or newer), and its rustfmt "reformatted" 45 already-correct files in `crates/`.
- Arm the git hooks from `postinstall` instead of a manual once-per-clone step. A fresh clone
  leaves `core.hooksPath` unset, so the pre-push quality gate was silently inactive in any new
  working copy.
- Declare the Node floor the project actually builds and tests on (Node 22 or newer), rather than
  a version nothing provisions or enforces.
