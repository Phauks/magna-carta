---
category: Added
audience: public
---

**Members come out of a tar and a 7z, and every extraction goes through one module.** `packages/file-manager/src/archive-members.ts` is the single door into an archive's contents: the format dispatch for listing AND extraction, one refusal vocabulary across every format, the firm's caps applied before any format-specific code runs, the budget a request shares across the members it takes, and the record of what each attempt cost and why it ended as it did.

The three questions an archive raises — what is in it, may this member be taken out, and what did taking it cost — were previously answered in three places, in zip's vocabulary, with the caps applied by whichever reader happened to run. A second format made that untenable and a third would have made it wrong.

A tar is the cheapest extraction on the platform: its members are stored whole, so taking one is a ranged read of its own bytes with no decoder involved. A 7z needs a real one — `crates/seven-zip-core` decodes the single block the member sits in, and because a solid block is one compressed stream over several members, reaching a later member costs the members ahead of it. That is why extraction carries a block ceiling of its own: a small member can sit at the end of a block that unpacks to gigabytes, and bounding only what the caller keeps would bound the wrong number.

A format whose reader needs a compiled engine arrives as an injected port, on the `MalwareScanPort` seam, so the domain package still carries no WebAssembly binding and a deployment that wired no engine refuses by name instead of crashing.

**rar lists and does not unpack, and that is the honest boundary.** Listing one walks its block headers and needs no decoder, which is what made it buildable. Decoding a rar member's packed data has no memory-safe implementation to build against and the reference implementation's licence forbids reusing its code. The Extract control says that rather than being offered and then refusing.

Also new: an entry that is a symbolic link, a hard link, a device node or a pipe is refused as `not-a-file` rather than filed as an empty document under a name that promises something else.

## Public

**Take files out of a tar and a 7z, not just a zip.** On a matter's Files page, open an archive and extract what you need — the same selection, the same checks on the way in, the same version history as a file you upload yourself.

A rar can be looked inside but not unpacked here. The Extract control says so up front instead of refusing after you click it; download the rar to open it.

When a member will not come out, the screen names which one and why: it is password-protected inside the archive (a 7z can lock its files one at a time, so some members of one archive may come out while others do not), it is packed in a way the application cannot open, it is a shortcut or a device entry rather than a file, or its contents do not match what the archive recorded for it. The rest still arrive.
