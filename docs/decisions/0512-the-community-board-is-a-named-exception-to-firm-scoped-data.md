---
number: 512
slug: the-community-board-is-a-named-exception-to-firm-scoped-data
status: Accepted
date: 2026-11-10
area: Community
summary: "The community board's five control-plane tables (community_profile, community_post, community_vote, community_comment, community_flag) are a named exception to the rule that business data goes through the firm-scoped data-access layer: people at many firms read and write the same rows, so the board cannot be firm-scoped. The exception is bounded by the @magna-carta/community package, which may not depend on the data-access layer or reach any firm's own database (held by its package-isolation test), and by two read rules: no read returns a firm, and no read returns who voted. Ratified by the owner on 2026-11-10."
---

**The community board is a named exception to the firm-scoped data rule, and nothing else is.**

**Context:** golden rule 3 says all business data goes through the firm-scoped data-access layer and
no query crosses firms. The community board on `community.magnacarta.esq`
([`docs/specs/2026-08-11-community-surfaces-design.md`](../specs/2026-08-11-community-surfaces-design.md))
is a cross-firm surface by definition: members of every firm post, vote and comment on the same rows.

**Decision.** The board's rows live in five control-plane tables and are written and read only by
`@magna-carta/community`. That package may not depend on `@magna-carta/data-access`, may not bind a
firm's database, and touches no per-firm schema, held by `packages/community/test/package-isolation.test.ts`.
A firm id is written on posts, votes, comments and flags for ranking (votes counted by distinct
firms) and moderation (spam hides on reports from several firms), and is returned by no read. No read
returns who voted, and a count below five is withheld. Nothing a firm keeps about its own clients or
matters is ever stored on the board.

**Consequences.** The board can exist at all. The exception is narrow by construction: it names
five tables and one package, so any other cross-firm store is a new decision, not an extension of
this one. The confidentiality controls (the format-only detector, the first-post hold, the single
confidentiality flag that hides) carry the weight that firm isolation carries elsewhere.
