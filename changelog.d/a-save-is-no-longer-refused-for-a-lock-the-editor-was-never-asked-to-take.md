---
category: Fixed
audience: public
---

**Saving in the editor was refused every time, because the host required a lock it never told the editor to take.**

The editor takes a lock on a document only when the host's CheckFileInfo answer says it supports locks. Ours never said so, so the editor never locked; and the host refused any save made without a held lock, answering a conflict, which the editor showed as the document having been changed by another user. The answer now advertises the lock contract it enforces (`SupportsLocks`, `SupportsUpdate`), and states `IsAdminUser` so the editor's server audit stops reporting it missing.

With locks in use, a second defect was waiting behind the first: one container serves a document, and a container that stops without unlocking left its lock in the session record, so the next instance's lock was refused and the document read as held by another editor. A plain lock request carrying a different value is now the successor taking over; releasing or refreshing a lock still requires the held value, so an old instance cannot release a successor's.

Also in the image: the editor's own "what's new" dialog no longer opens on every first open of a document. It remembers having been seen in the browser's storage for the editor's origin, and every document here is its own origin. Help › What's New still opens it; whether the editor was updated is the platform's version report to say.

## Public

Saving in the browser editor works, and co-editing the same document works. The editor's welcome dialog no longer appears every time a document is opened.
