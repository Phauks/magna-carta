---
branch: claude/directory-pronouns
worktree: .claude/worktrees/directory-pronouns (remote session)
area: directory — optional owner-entered pronouns on a person, and the document-assembly helper that renders them
status: building
touches: >
  packages/database/src/per-firm-schema.ts,
  packages/database/drizzle/per-firm/20260808T010000_directory-pronouns.sql (new) +
  meta/_journal.json + meta/0051_snapshot.json,
  apps/worker/src/per-firm-migrations.ts,
  packages/directory/src/{pronouns(new),statements,person,index}.ts,
  packages/directory/test/pronouns.test.ts (new),
  packages/data-access/src/pii-registry.ts (note on the directory_person entry),
  apps/worker/src/routes/directory.ts, apps/worker/test/conformance.test.ts (operation list),
  apps/worker/openapi/openapi.json + packages/api-client/src (regenerated),
  packages/document-assembly/src/{merge-statements,catalog/facets,catalog/generate,
  directory-role-bindings,staffing-bindings,resolve,assemble,types,dictionary,
  expression/{catalog,check,evaluate}}.ts,
  packages/document-assembly/test/{pronoun-*.test.ts (new), fixtures/shipped-keys.json},
  docs/user/features/, docs/decisions/pending/directory-pronouns.md, changelog.d/,
  status.d/directory-pronouns.md
---

Owner override on the standing "no pronoun helper" posture: the Directory gains optional,
owner-entered pronouns on a person entry, and document assembly gains the helper that renders them.

Pronouns are recorded as the **whole declension** the person states, never derived from a name, a
title, or a gender attribute. The unrecorded case is the common case and renders they/them through
the helper rather than throwing, blanking, or guessing. No gender field ships; the question is
flagged for the owner in the decision fragment.

**Migration idx 51** (`20260808T010000_directory-pronouns`). `claude/discovery-5-2-1` (PR #195,
unmerged) also holds idx 51 with tag `20260808T000000_discovery-review-coding-and-access`; the
timestamp here deliberately sorts AFTER theirs, so whichever branch merges second renumbers its own
journal entry to 52 with no reordering of the chain.

**UI is deferred to the owner** — no Svelte in this branch.
