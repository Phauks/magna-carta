---
category: Fixed
audience: public
---

**The matter status window's "read again on every opening" only ever read once.** The engagement read
was an `$effect` guarded by a plain `arrangementAsked` flag that `reset` — the shell's `onOpen` —
cleared. `ActionDialog` calls `onOpen` from an effect of its own, and a child component's effects run
after the parent's, so the guard was read before it was cleared: the window read the fee arrangement
on its first opening and never again for the life of the component.

Both facts the window re-reads (the engagement, and now the office the paper file is kept at) are
read from the opening transition itself rather than from an effect. The readiness reads stay effects
deliberately — they ask about the matter's own status, which only this window changes, so once per
visit is the whole of it.

## Public

**Reopening a matter's status window now shows the current fee arrangement.** If somebody amended the
agreement from another screen after you had opened this window once, reopening it used to keep
showing the old terms until you reloaded the page. It reads the agreement afresh every time it opens.
