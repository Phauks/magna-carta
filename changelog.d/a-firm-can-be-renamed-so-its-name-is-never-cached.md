---
category: Fixed
audience: public
---

**A renamed firm is named correctly again.** The per-isolate firm-row cache carried the firm's
display name, on the stated assumption that nothing renames a firm after provisioning — which is
wrong: a firm can be renamed, so for up to a minute every request served the old name. The name is
now resolved on demand (`FirmContext.readFirmName`) and the cache holds only what a rename cannot
falsify — that the firm exists, and its bucket. Two routes ask for the name, and both are ones where
a stale answer is wrong rather than untidy: the session bootstrap that puts it in the app shell, and
the file-integrity receipt, a document a firm relies on. `firm-absence-gate.test.ts` renames a firm
between two reads through one cached minute and asserts the second reports the new name; it was
confirmed to fail against the cached-name version first.

Also fixes five stale expectations in `me.test.ts` — `downloads:shelf`, `reports:export` and the
three `notes:*` keys reached the role seeds without updating the list, leaving that suite red on
`main` where the blocked CI gate could not report it.

## Public

**Rename your firm and it takes effect immediately.** Changing your firm's name is reflected right
away everywhere it appears, including on file-integrity receipts — previously the old name could
linger for up to a minute after the change.
