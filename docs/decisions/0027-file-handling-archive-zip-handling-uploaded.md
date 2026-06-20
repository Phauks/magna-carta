---
number: 27
slug: file-handling-archive-zip-handling-uploaded
status: Accepted
date:
area: File handling
---

**Archive (zip) handling:** uploaded zips stored **opaque** (versioned/hashed, never expanded server-side — no extraction code, hence no zip-bomb/password/nested-archive surface); **bulk download** builds zips by **streaming R2 → store mode → ZIP64**, version-pinned, access-checked, audit-logged, with an async-job→R2→signed-URL seam for very large bundles (live stream ships first). Reading/extracting archive _contents_ for discovery is **deferred but not designed-out** (likely client/desktop-side extraction → loose-file upload, original archive kept as as-received evidence).
