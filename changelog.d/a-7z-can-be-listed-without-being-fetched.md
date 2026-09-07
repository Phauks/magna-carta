---
category: Added
audience: internal
---

**A 7z archive's contents can be listed from its header alone.** `@magna-carta/seven-zip-listing`, over the new `seven-zip-listing-core` crate compiled to WebAssembly, answers names, sizes, the directory flag, timestamps and a per-member encrypted flag in the same shape the zip and tar listings already use.

It costs two ranged reads, or three when the archive's file list is compressed, and nothing else however large the archive is — the property that makes listing a multi-gigabyte object cheap. A 7z keeps its file list at the END of the file and normally LZMA-compresses it, so unlike zip and tar it cannot be read with arithmetic; the crate drives `sevenz-rust2`, which this repository already builds to WRITE the 7z bundles people download, so the codec was already in the tree and already consented. The engine returns the next range it needs rather than taking a reader, which is what keeps the caller in charge of what gets fetched.

An archive whose file list is itself encrypted is refused by name — the members are there, but nothing can show them without the password — while an archive with encrypted CONTENT and a readable list still lists, every member flagged.

Every size the archive declares about itself is checked before the reader allocates against it: the header blob, the decoded header, and the LZMA dictionary, which a hostile five-byte property can otherwise set to four gigabytes. The entry cap answers `truncated` rather than refusing. The one bound that is not closable from outside the crate — a header's declared file count, which `sevenz-rust2` allocates for before this code can see it — is documented where a caller will read it.
