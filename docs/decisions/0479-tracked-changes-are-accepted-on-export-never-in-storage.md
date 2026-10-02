---
number: 479
slug: tracked-changes-are-accepted-on-export-never-in-storage
status: Proposed
date: 2026-09-18
area: Documents & automation
summary: "A document the browser editor opens records every insertion and deletion with its author and time, and the STORED document keeps those marks for as long as it lives; every copy that leaves the platform — download, email, assembly output, the client portal — is produced with all changes accepted, by the conversion container the platform already runs. Chosen over accepting the marks at each version cut (which keeps files clean but makes the document forget its own authorship at every save, leaving attribution only in the platform's history) because a firm's record of who changed a filing and when is worth keeping in the document itself, and the risk that choice carries — redlines leaving the building — is closed at the one seam every outbound copy already passes through. Owner's decision, 2026-09-18, on the document history spec's section 3.3."
---

**Tracked changes are kept in the stored document and accepted only in copies that leave the platform.**

**Context:** The owner asked for history that matches what Google Docs shows: every state, and each
change attributed to the person who made it. The editor hands the host whole documents, never an
operation log, so the only per-person attribution that exists lives inside the document as tracked
changes — the same mechanism as Word's Track Changes. Recording on every open gives the platform the
marks to read into history; what to do with the marks afterwards was the open question, because a
document that records forever accumulates them and a copy sent outside the firm would carry every
redline.

**Decision:** The stored document keeps every mark. Nothing the platform does to a stored version
accepts a change. Every copy produced for outside the platform — the download, an email attachment,
an assembly's output, a client-portal share — is produced with all changes accepted, by the
conversion container, before it leaves. A member who turns "show changes" on in the editor sees the
document's whole record.

**Consequences:** History and attribution stay complete for the life of the document, and the diff
view in history reads from the document rather than reconstructing it. Every outbound path gains one
conversion step and must be enumerated: a path that hands out stored bytes directly would hand out
the marks. The stored document grows with its marks; a document edited for years carries a long
record, which is the point. The alternative, accepting at each version cut, is not taken: it keeps
files clean at the cost of the document forgetting its own authorship at every save.
