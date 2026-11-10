# @magna-carta/community — CLAUDE.md

**Purpose.** The community board's domain: the public, cross-firm feature-request and question board
served on `community.magnacarta.esq`. It holds the board's vocabularies, the rules for posting,
voting, commenting, flagging, triage and moderation, the format-only confidentiality detector, the
SQL over the control-plane `community_*` tables, and the zod contract the board's API is declared
over. It is the one package where people at many firms read and write the same rows, so it is
deliberately unable to reach any firm's own database.

**White paper:** _Community & feedback forum_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-11-community-surfaces-design.md`](../../docs/specs/2026-08-11-community-surfaces-design.md)
(the current design) and [`docs/specs/2026-06-17-community-feedback-board-design.md`](../../docs/specs/2026-06-17-community-feedback-board-design.md)
(the native-build decision it amends).

## Key files / entry points

- `src/vocabulary.ts` — post kinds, the seventeen product areas, request and question statuses, the
  roadmap columns, decline reasons, moderation states, flag reasons, and the board's limits.
- `src/board-service.ts` — the rules. Every function takes the database and the instant explicitly.
- `src/board-statements.ts` — the SQL, one statement per function, no rules.
- `src/confidentiality-detector.ts` — the format-only detector the composer and the write path share.
- `src/display.ts` / `src/ranking.ts` — the vote display floor, the display-name suggestion, and the
  trending formula (also computed in SQL).
- `src/contract.ts` — the zod request and response shapes.
- `src/sql-database.ts` — the minimal database shape this package writes through; D1 satisfies it.

## Invariants that apply here

- **No dependency on `@magna-carta/data-access`, no per-firm schema, no per-firm binding.** Held by
  `test/package-isolation.test.ts`. The control-plane tables are the only storage this package
  touches. This is what makes the cross-firm board safe, so it is not negotiable for convenience.
- **No read returns who voted, and no read returns a firm.** Votes are counted; the firm on a post,
  comment, vote or flag is written for ranking and moderation and rendered never. The one per-person
  vote read is "has this viewer voted", keyed by the viewer's own id.
- **A vote count below five is null in every response** (`displayedVoteCount`), so an early post
  cannot reveal which firm voted for it.
- **Every text has one home.** An author's delete and a moderator's removal blank the text in place
  in one write. Nothing keeps an edit history, and nothing copies a body anywhere else (notification
  emails link, never quote).
- **There is no general category.** Every category is a product area. The identity model (real
  display names, firm never shown) depends on that absence; adding a catch-all is a design change,
  not a vocabulary edit.
- **Confidentiality removes first and asks later.** The detector holds, a single confidentiality
  flag hides, and a human decides afterwards. Spam and abuse need reports from
  `SPAM_HIDE_DISTINCT_FIRMS` different firms.
- **A first contribution is held** until a moderator publishes something by that person.

## Dependencies & contracts

- Depends on `@magna-carta/identifiers` and `zod`. Tests use `@magna-carta/database`'s node:sqlite
  adapter at the current control-plane schema.
- The tables are declared in `packages/database/src/control-plane-schema.ts` (`community_profile`,
  `community_post`, `community_vote`, `community_comment`, `community_flag`). Their vocabularies are
  TypeScript-only, with no CHECK, because `community_post` is a parent table.

## Gotchas

- `listPosts` binds `now` as `?1` for every sort, because the trending ORDER BY reads it; filters
  start at `?2`. The count query keeps `?1` referenced so the same values bind to both statements.
- The trending exponent is a plain square because SQLite's math functions are a compile-time option.
  `ranking.ts` and the SQL must change together.
