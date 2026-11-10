---
category: Fixed
audience: internal
---

**Every new-tab opening goes through `$lib/navigation/open-beside` again.** Five screens had grown
their own `_blank` since the gate landed, so `apps/web/test/open-beside.test.ts` failed on `main`
and on every pull request's test slice. The About window's version link and the product-updates
pull request and commit badges now open with `opensBeside("external")`, the directory photo's
**View full size** with `openBeside(href, "file")`, and the two **Open in new tab** menu items (the
page actions menu and the Magnus conversation menu) with a new sixth reason, `requested`: the reader
chose a command whose whole meaning is a new tab. Every one now carries `noopener noreferrer`, where
three carried `noopener` alone and two carried `noreferrer` alone; nothing else a reader sees changes.
