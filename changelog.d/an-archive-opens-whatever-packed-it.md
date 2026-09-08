---
category: Added
audience: public
---

**Every archive the platform recognises can be opened and looked inside — without unpacking it.** A zip, a tar, a 7z and a rar all browse the same way: open one in the file manager and it shows what it holds, folder by folder, on the matter it sits on. Nothing is extracted, nothing is downloaded first, and a soft-deleted archive browses exactly like a live one.

Which format an object is comes from the object's own first bytes, never from its name, so an archive somebody sent under the wrong extension still opens and a text file named `.zip` is refused as what it is.

Each format is read from its headers alone — the zip's central directory, a tar's chain of 512-byte member headers, a rar's block chain in either generation, and a 7z's header at the end of the file — which costs two or three small ranged reads whatever the archive weighs. A multi-gigabyte production lists as quickly as a small bundle.

Two archives cannot have their lists shown, and each is named rather than reported as damaged: a 7z whose file list is itself encrypted (the members are there; the names need the password), and one packed by a coder no reader here covers. Both still download.

Taking members OUT remains zip-only, and the refusal now says so by name instead of claiming the other formats have nothing inside them — which a person looking at the listing can see is false.

## Public

**Open a zip, a tar, a 7z or a rar and see what is inside it.** On a matter's Files page, opening an archive shows what it holds, folder by folder, without unpacking it or downloading it first. A very large archive opens as quickly as a small one, because only the part that records what is inside is ever read.

What the archive is called does not decide this — its actual contents do. One somebody sent you under the wrong name still opens, and a file named `.zip` that is not one is told to you as what it is.

Two cases will not show their contents, and each says which it is: a 7z whose list of files is itself password-protected, and one packed in a way the application does not read. Both can still be downloaded.

Taking files out is still zips only. The other three can be looked inside, and the screen says so plainly rather than acting as though they were empty.
