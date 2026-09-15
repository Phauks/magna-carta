---
category: Fixed
audience: internal
---

**Three fitness tests were red on `main` and are green again.** All three came from the merge window's own commits, and none of them was a defect in the code they guard.

`schema-conformance` did not know `magnus_conversation_attachment`. It is a composite-key join table, which the test allows as a documented exception; the exception was never registered.

`schema-name-sync` did not know the alias `m`. The upload-attribution work joined `member` to resolve an uploader's display name and never added the table, its alias, its columns or the `uploaded_by_name` projection to the allow-list.

`generated-migrations` asserted that lexical tag order matches the journal's dense `idx` order, and two migrations from parallel branches merged out of that order. The assertion was wrong rather than the migrations: apply order IS tag order (`src/migration.ts` sorts the journal by tag, never by `idx`), chosen precisely so parallel branches merge without a shared counter, and `idx` is read only by the authoring scripts to find the entry drizzle just appended — the highest one whatever the tags say. It now asserts what the journal actually needs: a gapless `0..n-1` range, and a total tag order.

Renaming a migration to satisfy the old assertion would have been the real damage, which is worth recording. The applied ledger is keyed by TAG, and a tag a database has applied but the code no longer knows is a hard refusal on wake ("deploy mismatch") — so renaming either of those two would have taken down every firm that had already applied it.

Two of the three were invisible locally: the fitness sweep only runs when `packages/database` changes, so a branch that touches neither never sees them.
