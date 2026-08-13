---
category: Added
audience: internal
---

**The public changelog has a source, a contract, and a gate — the first of the community surfaces,
built alone.** A `changelog.d/` fragment now declares **`audience:`**, `public` or `internal`, and the
key is **required with no default in either direction**: assuming `public` would publish an internal
research note the first time somebody forgot, and assuming `internal` would let the public changelog
quietly stop being written, which is worse because nothing announces it. A `public` fragment carries
its customer-facing sentences in a **`## Public` block** below the developer entry — one file, one
commit, one review, two audiences, and no shared sentences to drift. `vp run changelog-build` folds
both halves in a **single pass**: the developer entry into `CHANGELOG.md` as before, the public entry
into the new **`docs/public-changelog.md`**, which it must, because folding deletes the fragment and
the public block lives nowhere else — a publish step deferred to later would have destroyed the prose
it deferred. Like `CHANGELOG.md` the new document is assembled and never hand-edited on a branch,
but unlike it the document is **curated on `main`**, where a dated section that arrives as one bullet
per fragment may be edited into the thematic roll-up a reader actually wants; what curation never
does is author a change with no fragment behind it. **`pnpm run lint:changelog-fragments`** (in the
gate's governance job, and re-run over the whole set inside the assembler before it folds anything)
refuses a fragment with no audience, a public one with no block, an internal one carrying a block
nothing would read, an unknown category, a non-kebab-case filename, or an emoji — golden rule 2's ban
is enforced here because bulleted highlights with emoji prefixes are the house style of every hosted
changelog product, and a published entry cannot be edited afterwards. New package
**`@magna-carta/product-updates`** holds the artifact schema and a **strict** parser from the
assembled document: it refuses a mistyped category heading, a bullet above the first dated heading,
an unparseable release heading, and a duplicate date, because the failure worth guarding is silent
omission — a shipped change dropping out of the published changelog with nothing raised. Entries are
**dated rather than versioned** since no release has been cut, with a `version` field carried and
null so the day one is cut is an edit to the document rather than a schema change. There is no
committed generated artifact and deliberately no drift gate: consumers build it from the document at
their own build time, so it cannot fall out of step. The five fragments then in `changelog.d/`
migrated to `audience: internal` mechanically. **No board, no votes, no database, no screen** — the
surface holds no firm data at all, which is why it sits outside the firm-scoped data-access rule by
having no business data in play rather than by taking an exception to it. 58 tests.
