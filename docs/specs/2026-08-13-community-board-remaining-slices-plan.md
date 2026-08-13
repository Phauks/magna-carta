# Community board — what slice 2 built, and the slices after it — plan

**Status:** Active · **Date:** 2026-08-13 · **Owner:** Trevor Goldsmith
**Design (authoritative):** [`2026-08-11-community-surfaces-design.md`](2026-08-11-community-surfaces-design.md)
**Decision produced:** `community-board-is-a-named-cross-firm-exception`

The design settles what the board is. This plan records what slice 2 actually built, what it
deliberately did not, and in what order the rest should follow. It re-decides nothing.

---

## 1. What slice 2 built

**Control-plane schema** — `community_profile`, `community_post`, `community_vote`,
`community_comment`, `community_flag`, `community_moderation_action`, and the post-number counter
and allocation pair. One control-plane migration, journal idx 5.

**`@magna-carta/community`** — the category taxonomy (seventeen product areas, no general one), the
closed sets, the format-only confidentiality detector, the distinct-firm ranking and its display
floor, the slug, the composer's standing copy, the kill-switch reader, the public projections, the
wire contract, and the statement builders. It declares its own SQL interface and imports no per-firm
module; a purity test fails the build if that changes.

**`apps/community-worker`** — a new deployable binding the control-plane database and one key-value
namespace and nothing else. Public reads (categories, notices, post list with trending/top/new and
keyset paging, one post, a thread, the roadmap projection); member writes (profile, create, edit,
delete, vote, withdraw, comment, delete comment, accept answer, report a post, report a comment);
operator moderation (queue, status with a required decline reason, hide, restore, remove, convert a
question to a request, merge a duplicate carrying its votes, approve a first write, archive stale).

**Tests** — 68 in the package (taxonomy absence, detector behaviour including its own false-positive
posture, ranking parity between the comparator and the SQL, projection identity, purity, and the
data-access behaviour against the real migration) and 36 in the worker (the binding scan, the access
levels, the contract, and the end-to-end board).

---

## 2. Slice 3 — the screens

A separate dispatch. Nothing in `apps/web` was touched. What the screens need from this slice is in
section 5.

---

## 3. Slice 4 — the loop back to the changelog

The design's one deliberate improvement on the reference product: a shipped changelog entry links
back to the request that asked for it, and that post's voters and commenters are emailed a link.

- A nullable `linked_changelog_anchor` on `community_post`, written when a request moves to
  `completed`.
- Subscriber carry: a voter and a commenter are implicitly subscribed; one opt-out flag.
- The notification itself goes through the platform's existing outbound mail. **The email links and
  never quotes** — a quoted body sits in inboxes forever and cannot be unsent, which matters most on
  exactly the board where a post may later be removed for confidentiality.
- Needs the community worker to reach the mail path, which it currently cannot and should not: the
  right shape is a row the application worker's outbox relay picks up, not a new binding here.

---

## 4. Later, in rough order

| Item                             | Note                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled sweeps**             | Archive-at-twelve-months and the thirty-day triage clock are operator-invoked routes today. They belong on a cron, which this worker has no handler for yet.                                        |
| **The generated typed client**   | The board emits its own OpenAPI document at `/api/openapi.json`. Folding it into the client pipeline means the generator reading two documents, which is a pipeline change rather than a route one. |
| **Turnstile on writes**          | The design lists it beside the provisioned-firm requirement. The provisioned-firm requirement is built and is the stronger of the two; this is the cheap second layer.                              |
| **A distributed rate limiter**   | Today's is per-isolate. The seam is `RateLimiter` in `src/rate-limit.ts` and swapping it is not a contract change.                                                                                  |
| **Reporter reputation surfaced** | The statement that counts a reporter's cleared reports exists and nothing reads it yet. Repeat false flagging is meant to be visible on the account.                                                |
| **RSS**                          | Named in the design for the changelog. Cheap here too once there are screens to link into.                                                                                                          |
| **Attachments**                  | Off at launch by design, and the design names this as the recommendation most likely to be wrong in practice. Revisit with moderation capacity and a measured need, not before.                     |

---

## 5. What the screens need from this slice

Everything below is live on `apps/community-worker` today.

**Reads, no session required.** `GET /api/v1/community/categories` (keys plus labels — render the
labels, submit the keys); `GET /api/v1/community/notices` (the first-post notice, the permanent
venue line beside the composer, the send-to-support label, and the attachments-unavailable copy —
all four are served rather than written into a screen so web and desktop say the same words);
`GET /api/v1/community/posts` (query: `kind`, `category`, `status`, `sort` of trending/top/new,
`limit` up to 50, `cursor`; response `{ data, nextCursor }`, and `nextCursor` is opaque);
`GET /api/v1/community/posts/{number}`; `GET /api/v1/community/posts/{number}/comments`;
`GET /api/v1/community/roadmap` (three columns, no dates anywhere).

**Writes, session required.** `PUT /api/v1/community/me`; `POST /api/v1/community/posts`;
`PATCH`/`DELETE /api/v1/community/posts/{number}`; `POST`/`DELETE
/api/v1/community/posts/{number}/vote`; `POST /api/v1/community/posts/{number}/comments`;
`DELETE /api/v1/community/comments/{reference}`;
`POST /api/v1/community/posts/{number}/accepted-answer`;
`POST /api/v1/community/posts/{number}/reports`;
`POST /api/v1/community/comments/{reference}/reports`.

**Operator.** `GET /api/v1/community/moderation/queue`; `POST
/api/v1/community/posts/{number}/status|hide|restore|remove|convert-to-request|merge`;
`POST /api/v1/community/moderation/profiles/{reference}/approve`;
`POST /api/v1/community/moderation/archive-stale`.

**Five behaviours a screen has to be built around, not bolted onto.**

1. **`202` is a success.** Creating a post returns `201` when it published and `202` when it was
   held — either because the account has never had a write approved, or because the content check
   recognised something. The `202` body carries `heldReason` and `signals` (signal names only,
   never the matched text). A screen that treats `202` as an error will tell a member their post
   failed when it did not.
2. **`distinctFirmVoteCount` is absent below five firms.** Absent, not zero and not "fewer than
   five" — the absence is the disclosure control. Render the raw `voteCount` always and the firm
   count only when the field is there.
3. **There is no author firm, anywhere, and there never will be.** `author` is
   `{ reference, displayName, badge }`. Do not add a column for a firm and do not infer one.
4. **A hidden post is a `404`, with no placeholder.** Do not render "removed by moderator" in its
   place — a marker over a suspected disclosure points straight at it.
5. **A category is required before a post can be composed.** The composer asks which part of the
   software this is about before the member writes a word. That is the board's primary
   confidentiality control, so the field is not optional, not defaulted, and not last in the form.

Two smaller ones: `503` with type `community-board-read-only` carries `refusalNotice`, which is the
operator's own words and should be shown verbatim; and the moderation surface answers a
non-operator with `404` rather than `403`, so a screen must not treat that `404` as "the page moved".

---

## 6. One open question for the owner

**How does a session token reach `community.magnacarta.esq`?** The platform's session cookie is
host-only by deliberate design and pinned by a test — a parent-domain cookie would be sent to every
firm's branded subdomain and to the cookieless content host. So a cookie set by the application's
host is not sent to the board's host.

This does not affect reading, which needs no session. It does affect every write. The resolver in
`apps/community-worker/src/session.ts` accepts the token from either the cookie or an
`Authorization: Bearer` header and validates it against the control-plane `session` row, so all
three of the plausible answers work against the code as written:

- **Serve the board on the application's host** (`app.magnacarta.esq/community`) and keep
  `community.magnacarta.esq` as a redirect for the public read path. Cheapest; gives up the separate
  origin for authenticated traffic.
- **A same-origin handoff:** the application mints a short-lived board token the screens send as a
  bearer header. One new endpoint on the application worker; keeps both origins.
- **Cross-subdomain cookies.** Rejected here, and named only to close it off: the existing decision
  against them is about tenant isolation, and this board is not a reason to reverse it.

Nothing in slice 2 depends on which is chosen.
