---
category: Added
---

**Every file the platform stores now carries, on the file itself, which matter it belongs to and what
kind of thing it is.** Until now that answer lived only in the firm's database: the storage key is
deliberately meaningless (`files/<opaque>/<opaque>`), so that renaming a document or moving it to
another matter moves no bytes and costs nothing. The price of that choice was that anything looking at
the stored file alone — a search index reading the firm's storage, a storage report, someone answering
"what of ours is in here" — could not tell whose matter it was.

**Why now, when nothing yet reads it.** Because the cost of adding it runs the other way from almost
everything else: writing it as each file is stored is free, and adding it later means rewriting the
metadata of every file every firm has ever stored. It is the same reasoning that put the storage
encoding on file versions before there was anything to encode. The natural-language document search
design depends on it and copies it rather than working it out again, but it earns its place without
that: a fact about a file that travels with the file is useful to everything that ever meets the file.

**It cannot be quietly forgotten.** Uploads go straight from the browser to storage and never pass
through the platform, so for those the stamp is part of what the upload's signature covers: an upload
that leaves it off is refused outright rather than landing a file nobody can place. Everywhere the
platform writes a file itself, an automated check over the source code fails the build if a new
storage path is added without one. And a file that belongs to no single matter — a download bundle
spanning several, a template the whole firm draws on, an email original that the same message may be
filed from onto three different matters — records exactly that, so "no matter" is an answer rather
than an omission.

**What already exists is repaired in the background.** A nightly pass finds files stored before any of
this and fills in what they were missing, a bounded number at a time so it never becomes a burst,
picking up wherever it left off if anything fails. Nothing about the file itself changes — the bytes,
the type, and the storage tier are carried across untouched — and the pass simply finds nothing to do
once a firm is caught up. From then on it doubles as a standing check: a count that stops being zero
means a new storage path forgot, on the day it shipped rather than months later.
