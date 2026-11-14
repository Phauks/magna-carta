---
number: 526
slug: content-disarm-is-in-house-rust
status: Accepted
date: 2026-11-13
area: File handling
summary: "Content disarm and reconstruction is built in house as a pure-Rust crate (crates/disarm-core) that neutralizes in place rather than re-rendering to pixels: PDF, Office packages, RTF and pictures, each re-verified after writing. It replaces the white paper's Glasswall or pixel-rebuild options. Legacy binary Office files are refused, not disarmed."
---

**Content disarm is an in-house Rust engine that removes what can act and keeps what a person reads.** The owner ruled on 2026-11-10 that disarm is built here, in Rust, rather than bought.

**Context.** The untrusted-file design named a disarmed rendition as an optional stage and offered two
routes: a commercial SDK (Glasswall) or a pixel rebuild through the render containers in the manner of
Dangerzone. The owner declined a commercial engine for scanning and asked for disarm to be written
here. A pixel rebuild loses text, form fields, links and searchability, which in a legal file is most
of what matters, and it runs every document through the office suite this design is trying to protect.

**Decision.**

- `crates/disarm-core` neutralizes structurally: a dangerous PDF action becomes a null object, an
  Office macro project is deleted, an embedded object is replaced with an empty compound file so the
  document still opens without a repair prompt, a DDE field keeps its shown result and loses its
  instruction. Pages, text, ordinary fields, bookmarks and web links stay.
- It depends only on memory-safe libraries already in the workspace (pdf-core, lopdf, zip over
  miniz_oxide, quick-xml, cfb, image). Golden rule 14 holds with no consent needed.
- Every format re-reads its own output and fails the call if anything it promised to remove is still
  present. A copy that is mostly disarmed is never offered.
- A format it does not understand is refused. Legacy binary Office files (`.doc`, `.xls`, `.ppt`)
  are refused until a pipeline converts them to their package form first.
- The original is never modified; the disarmed copy is a separate file and is named with the plain
  extension when its kind changed (`.docm` to `.docx`).

**Consequences.** One engine serves the browser (the File Workbench, through `@magna-carta/disarm`)
and, later, a pipeline stage that files a disarmed rendition beside an upload. The rendition's
storage and when it is made are not decided here. The WebAssembly build is about 10 MB (3.4 MB
compressed), most of it pdf-core, so it is loaded only when asked for. Supersedes the "Glasswall SDK,
or a Dangerzone-style pixel-rebuild" wording for the CDR stage in the white paper's untrusted-file
handling.
