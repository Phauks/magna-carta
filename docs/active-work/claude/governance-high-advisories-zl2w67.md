---
worktree: /home/user/magna-carta (remote session)
area: Getting the gate green on main — the tests and lints that recent merges outran while the gate ran nothing
status: review
touches: packages/access-control/test, packages/document-assembly/test, packages/fixtures/src/load-profile, apps/api-worker/test, changelog.d/
---

Third stream on this branch. #471 cleared the advisories and #478 re-sectioned the gate; what is left is that `main` had no green gate for a month and several fitness functions and exact-list tests were outrun by merges nobody could run them against. This stream fixes each at its root so the gate is usable again. Small, test-side changes only; nothing here should collide with product streams.
