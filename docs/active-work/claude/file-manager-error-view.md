---
worktree: claude/file-manager-error-view
area: file-manager (mockup + ruling harness)
status: in-review
touches:
  - docs/conventions/file-manager-rulings.md
  - tooling/file-manager-rulings/index.mjs
  - changelog.d/
---

# The error view

Builds the last approved UI item from round seven of the matter file manager review: the error
state, and the reporting path behind it.

The error screen now carries the request that failed (`GET /matters/.../files`), the status
(`504`), the time, and the Error ID the person can quote — and it opens by saying the record is
unaffected, because that is the first thing anyone needs to know. Three first steps follow, each
with the reason it is worth trying.

Report a Problem opens a real reporter rather than an inert button. It lists what is sent, leaves
the screenshot unticked, and states plainly that no document, file name or matter content is
included — the redact-by-default rule from
[`docs/conventions/error-logging.md`](../../conventions/error-logging.md), said out loud to the
person deciding whether to send.

One correction rides along: the scroll ruling had been marked settled off a dialog fix. The error
view is a pane, not a dialog, so that cap never applied to it. The pane now scrolls inside its own
container, and the check measures the pane rather than a dialog that was never on screen.

Harness: 59 checks, all passing.
