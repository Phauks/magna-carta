---
worktree: claude/project-thread-tuiufv (cloud session)
area: In-app wording, the first batch of a copy review across the web app
status: review
touches: apps/web/src, apps/web/test, packages/design-system/src/stories
---

Rewrites user-facing copy in place, string by string, with no change to behaviour or layout. The first batch replaces the "Nothing answered" network-failure lines with "Couldn't connect." plus what did not happen, removes em dashes from UI strings, and shortens the matter section descriptions. Areas with open work elsewhere (conflicts, meetings, directory, signing, Magnus, the PDF editor) are left alone. A concurrent stream editing a string in the same file may see a one-line merge conflict on that string.
