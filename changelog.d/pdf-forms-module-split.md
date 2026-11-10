---
category: Changed
audience: internal
---

**The PDF engine's forms code is split by what it does, and the crate has an area note.** `crates/pdf-core/src/forms.rs` was 3,255 lines holding the field-tree walk, the text-field drawing, the fill and flatten writers and 1,750 lines of tests. It is now `src/forms/`: `mod.rs` (types, the walk, `read_form`), `appearance.rs`, `fill.rs`, `flatten.rs` and `tests.rs`. Code was moved, not changed: the public functions and types, the WebAssembly exports and all 319 unit tests are the same. `crates/pdf-core/CLAUDE.md` is new and says where each operation lives and the rules every new one must follow.
