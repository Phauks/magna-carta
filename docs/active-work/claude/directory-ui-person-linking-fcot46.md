---
worktree: /home/user/magna-carta (remote session)
area: New Person on the side rail — every section of a person's record reachable at creation, the contact and identifier models rebuilt (typed identifiers with shape checks, contact in four kinds with a checked email and a country-carrying number), one atomic create
status: building
touches: packages/directory/src/{identifiers,identifier-shape,email-address,person-record,types}.ts, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, apps/api-worker/src/routes/directory.ts, apps/api-worker/openapi/openapi.json, packages/api-client, apps/web/src/lib/directory, apps/web/src/routes/(app)/directory, docs/specs/2026-09-02-directory-linking-design.md, docs/user/features/directory.md, changelog.d/
---

Second stream on this branch, restarted from `main` after #494 landed. The design is the canvas the
owner chose direction B on (2026-09-03, "New Person" artifact) and the rulings recorded in the
spec's §7 under 2026-09-03. What this stream builds, in order:

1. **Foundations.** Identifiers become typed shapes: the type decides the fields and checks the
   form (SSN nine digits, EIN nine, licence is region + number, bar number is jurisdiction + number,
   an account is who it is held with plus number, username and secret, sealed as one value with the
   blind index on the number). `directory_identifier` gains a plaintext `label` (the region, the
   jurisdiction, who an account is held with) so the list can name what it holds without a reveal.
   The `dob` kind leaves the catalog (dates live in Dates); the bare account kind is replaced. Email
   is checked for a mailbox and a domain on both sides. A number carries its country from a
   dial-code control and formats as it is typed (`libphonenumber-js`, already in the lockfile
   through `class-validator`); fax is its own kind.
2. **One atomic create.** `POST /directory/persons` takes the whole draft and writes it in one
   batch, so a person is never half-recorded.
3. **Sections as components** under `$lib/directory/sections/`, each a dense list plus a kind-first
   add row, used by the New Person dialog to draft and by the record panes to persist.
4. **The dialog** on `ActionDialog` at record width: vertical `Tabs` rail with counts, the
   duplicate gate and On This Record in the context pane.
5. **Panes on the sections; Categories off the person record.**

Environment notes from the first stream still hold (`node tooling/bootstrap/index.mjs`,
`svelte-kit sync` after a route change, story tests from `packages/design-system`).
