---
number: 415
slug: a-file-nobody-trusts-is-the-reason-the-workbench-exists
status: Proposed
date: 2026-08-31
area: Tools area
summary: "The ten file utilities get one host rather than ten screens: the File Workbench at /tools/file-workbench, where a file that belongs to no matter is dropped once and every capability addresses it. Three rules bind. A malware verdict is a FACT ABOUT THE FILE AND NEVER A GATE ON THE SCREEN — a file somebody does not trust is precisely what this surface is for, so a flagged file is marked and still gets every reading, which is the matter file manager's settled ruling for filed documents applied to unfiled ones and is held by a fitness test asserting no capability's applicability changes with the verdict. The capability set is a REGISTRY of self-contained modules, so adding one is a module plus an array entry, and the Overview is contributed by the modules through an optional summary rather than hand-written, which is what keeps the synthesis from going stale as the set grows. And the surface stays EPHEMERAL BY CONSTRUCTION: this host wires in no history source and no version source, so a record of an unfiled file cannot exist rather than merely not being written. Capabilities are not peers — the cheap reversible readings run on arrival, anything that writes a file or discloses content waits to be asked, and conversion alone acts on the whole selection so a production of sixty scans is one gesture."
---

**A file somebody does not trust is the reason this surface exists, so the scan verdict marks a file
and never takes its readings away.**

**Context:** Ten tools in the `files` subject group each demanded their own upload of the same bytes:
convert, scrub metadata, hash, unlock, verify type, detect AI text, repair, recognize text, read an
email, scan for malware. Nobody arrives asking which of ten tools they need. They arrive holding a
file and asking what it is and what can be done with it, and that is one screen.

An earlier draft of this surface answered a related question the wrong way. It treated the malware
scan as a gate: a flagged file was excluded from every other capability, its bytes neither hashed nor
identified nor read for metadata. The reasoning was that an untrusted file should be touched as little
as possible. The reasoning is backwards. An attachment nobody trusts is exactly the file a person
brings here — that is what an unfiled scratch surface is FOR — and the readings a gate would withhold
are the ones that answer whether to trust it. Withholding them leaves a person with a red mark and no
way to learn anything more, which is how a file ends up opened somewhere else instead. The matter file
manager settled this for filed documents already: "Nothing here blocks a file. A file that failed a
scan is shown where its owner put it, marked, and remains selectable and downloadable: refusing to
show it is the greater hazard."

**Decision:** one host, three binding rules.

**The verdict is a fact, not a gate.** Every capability runs on a flagged file. The verdict is
reported — on the file's row, and as a row in its Overview — and it changes nothing else. Nothing in
the capability layer may read it, which is a claim a test can hold: the applicability of every
capability is evaluated against the same file under each verdict and the answers must be identical.
The one thing a flagged file is not given is a preview drawn from its own bytes, and that is not the
verdict acting as a gate — no file gets one, because a document preview goes through the cookieless
delivery host and this host does not upload.

**The capability set is a registry.** Each capability is a self-contained module declaring its
permission, its stage, when it runs, whether it acts on one file or the selection, whether it applies
to a given file and why not, and optionally the one row it contributes to the Overview. Adding a
capability is that module plus a line in one array; the tab strip, the permission gate, the bulk-action
set and the summary all derive from the array. The Overview in particular is not a hand-written list of
the other capabilities — it renders what the registry hands it — because a hand-written synthesis is
the part that silently goes stale, and it goes stale in the direction of understating what the product
can do. A capability whose engine is not wired yet declares no panel and gets the standard treatment
from one component: its real control, disabled, with the Soon mark and the dependency named.

**The surface is ephemeral by construction.** This host supplies dropped files and wires in no history
source and no version source, so a record of an inspection cannot be written rather than merely not
being. Retaining information about files the firm never filed is the thing the Tools area must not do,
and a guarantee that lives in the shape of the code outlasts a discipline that lives in a reviewer's
memory. The same body serves a matter's files later, where a history IS legitimate because it hangs off
a record that already exists; that host wires those capabilities in.

**Capabilities are not peers, and the order says so.** The cheap, in-house, reversible readings — what
the file is, what it hashes to, what the scanner made of it, what metadata it carries — run the moment
a file arrives, because they change nothing and because every other capability's applicability turns on
what the file is. Anything that writes a new file, costs money, or sends content anywhere waits to be
asked. Conversion alone acts on the whole selection, because a production arriving as sixty scans that
all have to become PDFs is one gesture and not sixty, and a bulk conversion offers only the formats
every selected file can reach: offering one that half the selection cannot become, then failing
partway, is worse than not offering it.

**Consequences:** the ten catalog entries stay `soon` and keep their own permissions, which now gate
the capabilities inside the workbench rather than ten separate pages; a member without
`tools:decryption` sees no Unlock tab. Two capabilities are real in the browser with no backend at all
— the type read from the leading bytes, and the digests — and both say where their answer came from,
because a browser digest is feedback and only a server digest over the bytes the server received is
evidence. The prefix reading never contradicts an extension it cannot actually rule on: text is text,
so a `.csv` read as text is `unverifiable`, never a mismatch, since a mismatch warning is worth
something only while it is rare. The remaining eight need the firm-scoped scratch object, which is the
next piece of work and the one that also makes the retention promise real.
