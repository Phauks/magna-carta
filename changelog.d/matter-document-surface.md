---
category: Added
---

**A matter's documents now have a working screen.** Open a matter, go to Files, and the whole
loop is there on real records: what the firm holds for that matter, adding something new to it,
saving the next version of it, and reading the history of every version kept.

**Two ways to add one.** From a file you already have — drag it in, and it goes straight to storage
without passing through the application, is checked, and appears. Or from one of the firm's
templates: pick one, and the document is built against this matter and filed onto it like any other.
If the merge could not fill something in, the screen says which fields were left blank and which
ones are printing text left over from the template, because a document that reads as finished and is
not is exactly the failure worth catching before it goes out.

**Nothing on the screen is decoration.** A document still being checked says so; one the scanner
rejected is listed with its reason rather than silently never appearing; a document with no cleared
version cannot be opened, and the controls that would open it say why. Saving never overwrites — the
returning bytes are checked and kept as the next version, and the previous one stays exactly as it
was, with its size and content hash.

**Editing in the browser is honest about where it is.** Opening the editor is a real operation: the
document moves to co-editing, the open is recorded, and a signed token scoped to that one version is
minted. The editor itself is served by a separate per-document container that exists only in a
deployed environment, so on a developer's machine the frame stays empty and the screen says that
plainly rather than looking broken.

**Matters can now be reached by their own address.** Until now the matter screens resolved only the
three built-in samples, so a firm's actual matter could not be opened at its own URL at all. It reads
the firm's record first now and falls back to the samples, and the two are never confused: a sample
matter says it is one and offers nothing that would write to a firm.
