# Community feedback board + product-updates surface — design

**Status:** Accepted (design) · **Date:** 2026-06-17 · **Owner:** Trevor Goldsmith
**White-paper home:** _Community & feedback forum_ (§30) and _Product updates (changelog, release notes & roadmap)_ (§31)
**Research input:** changelog/feedback-tool survey 2026-06-17 (Linear, ClickUp/Canny, GitHub, Stripe, Vercel, Notion, UserJot, Featurebase, Frill, Productboard, Fider) — synthesized inline
**ADRs:** **ADR-0044 (amended — native build supersedes the deferred-Fider lean)**; extends **ADR-0048** (product updates, unchanged) and **ADR-0037** (living docs); reuses Better Auth (control-plane), Cloudflare email, and KV.

A native, in-house **feedback board** (feature requests + upvoting + comments + status pipeline + a roadmap-by-status view + known-issues), plus the already-accepted **product-updates** surface (changelog, release notes, roadmap, live status — ADR-0048, no change). The two connect through one loop: when a shipped request reaches `completed`, its subscribers are emailed a deep-link to the changelog entry. **Backend logic and data model only; no UI this round.**

**Deferred:** implementation is deferred until Fable is available again. This document is the decision and the spec; it ships no code. The implementation plan is a separate, later slice.

**Why native, not Fider (ADR-0044 amendment).** §30 leaned toward self-hosting Fider. The 2026-06-17 survey makes that the weakest part of the plan: Fider requires **PostgreSQL + mandatory SMTP**, is **AGPL-3.0**, and ships **no changelog and no roadmap/kanban UI** — only posts/votes/comments/statuses. None of that maps to our Cloudflare per-firm D1/R2/Workers + Cloudflare-email stack, and AGPL network-copyleft is a real obligation on a fork. Fider's actual surface is tiny (posts → votes → comments → tags → 6 statuses → 3 roles → outbound webhooks), so a native build is **less total work than operating an off-Cloudflare host + Postgres**, and it is the only path that keeps everything on Cloudflare and honors the confidentiality boundary §30 already declares non-negotiable. Per-tracked-user hosted tools (Canny) remain rejected for the per-seat cost-scaling the platform exists to escape.

**Build gates:** deferred to a future slice (see above). No build-when-measured gate on the data model itself — schema columns and the package seam are the cheap-from-the-getgo parts (ADR-0078). The public logged-out rendering and SEO concerns ride the broader public-pages work and are out of scope here.

---

## 1. Module placement — a clean, extractable package

New package **`@magna-carta/community`** (the `@magna-carta/government-links` / `@magna-carta/property-links` pattern): self-contained, owns its own schema, structured so it could spin out into its own repo later.

- `src/schema/` — the control-plane D1 tables (posts, votes, comments, tags, post-tags, forum profiles).
- `src/types.ts` — `Post`, `Comment`, `Vote`, `Tag`, `ForumProfile`, `PostStatus`, `BoardCategory`.
- `src/data-access/` — the board data-access functions (queries + mutations), scoped to the control-plane binding.
- `src/contract/` — the OpenAPI/zod request/response schemas (consumed by a Worker route; the route itself lives with the worker, not here).
- `src/notify.ts` — the subscriber-carry + Cloudflare-email notification logic (the loop; see §6).

**Isolation is the boundary, and the boundary is the point.** The package is **platform-level, public, cross-firm — it never imports the firm-scoped data-access layer and never binds a per-firm D1.** That isolation is exactly what makes it extractable and what enforces the confidentiality boundary in code. A fitness function asserts the package has no dependency on `@magna-carta/data-access` and no per-firm binding (mirrors the process-refs / design-system purity scans).

## 2. Data model (control-plane D1)

Platform-level, cross-firm, public-read. Not per-firm D1; not the per-firm DAL.

```ts
type PostStatus =
  | "open"          // default on creation; not yet triaged
  | "under_review"  // acknowledged, being considered
  | "planned"       // accepted, on the roadmap
  | "in_progress"   // being built
  | "completed"     // shipped
  | "declined"      // won't do
  | "duplicate";    // merged into another post (see duplicateOfId)

type BoardCategory =
  | "feature_request" // the v1 board
  | "discussion";     // dormant seam — see §5
```

- **Post:** `id`, `number` (human-facing sequential, stable in URLs), `slug`, `title`, `body` (markdown), `authorUserId` (real account — admin/moderation only), `authorDisplayName` (the only author identity shown publicly), `category` (`BoardCategory`), `status`, `duplicateOfId` (nullable), `voteCount` (denormalized), `commentCount` (denormalized), `createdAt`, `updatedAt`.
- **Vote:** `postId`, `userId`, `createdAt`. **Upvote only, one per user** (unique on `postId+userId`). `voteCount` is the only thing ever exposed — **never "who voted."** Admin vote-on-behalf records the real `userId` but is admin-initiated.
- **Comment:** `id`, `postId`, `authorUserId`, `authorDisplayName`, `body` (markdown), `createdAt`, `isAdminResponse` (an official status note renders distinctly, as in Fider).
- **Tag:** `id`, `name`, `color`, `isPublic` (private/collaborator-only tags exist for triage). **PostTag** join.
- **ForumProfile:** `userId` (Better Auth identity), `displayName`. The display name is set on first post/vote, defaults to the account's first name; **real name and firm are never written to any public-facing column.**
- **Subscription:** a voter is implicitly a subscriber to status changes on that post; a commenter likewise. An explicit `unsubscribed` flag lets a user opt out (the only state stored beyond the vote/comment rows).

## 3. Identity & confidentiality

- Public surfaces show **`authorDisplayName` only** — a handle defaulting to first name, never the real name or firm, on what is an indexable page.
- Admins (you / owner-admin) always resolve the real authenticated identity (`authorUserId`) for moderation, regardless of display name.
- Votes are **aggregate counts only**; the voter list is never exposed on any read surface.
- The board **never touches per-firm or privileged data.** Posting is always opt-in and user-authored; nothing flows automatically from private matters or the private bug-reporting pipeline (_Observability and diagnostics_) into the public board. This restates §30's non-negotiable boundary and is enforced by the package isolation in §1.

## 4. Roadmap = a filtered view, not a second store

The public roadmap is a **projection of the board by status** — kanban columns **Planned / In Progress / Shipped** map to `planned` / `in_progress` / `completed`, with `voteCount` visible on each card and vote-from-roadmap supported. No separate roadmap data, no double-authoring. (Distinct from the `ROADMAP.md`-derived product-updates roadmap of ADR-0048, which is the firm's own internal/forward plan; the board roadmap is the popularity-ranked user-request view. The two can cross-reference but have separate systems of record — board posts vs. `ROADMAP.md`.)

## 5. Forum-ready seams (built, dormant)

The decision was "board now, forum-ready seams." The `category` discriminator (`feature_request` | `discussion`) is the seam: open peer discussion categories switch on later by enabling `discussion` posts and a category index — **no schema reshaping.** Comments already give threaded discussion *within* a post, so v1 has "discussion" without standalone threads; the dormant seam covers standalone discussion topics not tied to a request. Moderation tooling (merge, edit/delete, block, status, tags) is built for the board and serves discussion unchanged when it switches on.

## 6. The loop — subscribers travel, one publish notifies

The mechanic every good tool shares: **automate the subscriber carry + the notification, not the prose.**

- When a post moves to `completed` and the corresponding change ships, its subscribers (voters + commenters who have not opted out) receive a **Cloudflare email** deep-linking to the changelog entry.
- The changelog entry itself stays authored in `CHANGELOG.md` (ADR-0048) — we never auto-write narrative, preserving **version-accuracy by construction**. The loop links a board post to a changelog entry by a stable reference (the changelog entry id/anchor in the product-updates artifact); a post optionally carries `linkedChangelogAnchor`.
- Roadmap items in the product-updates surface (ADR-0048) may show **read-only vote counts** enriched from the board ("popular requests inform the roadmap") — the optional vote-count seam ADR-0048 already reserved.

## 7. Product-updates surface (ADR-0048) — confirmed, unchanged

No change to the accepted design; recorded here so the two pages read as one connected system. Buildable standalone whenever scheduled:

- Build step derives **`product-updates.json`** from `CHANGELOG.md` + `ROADMAP.md` (schema is the contract; malformed input fails CI).
- Live **known-issues / service-status** banner in **control-plane KV**, written via an owner/admin RBAC-gated endpoint (no deploy).
- Per-user **`lastSeenProductUpdate`** marker (Settings framework) → "What's New" unread badge.
- Public read surfaces render as Workers static pages from the artifact + KV; the board (this package) provides the requests/votes/discussion the static pages link into.

## 8. Operational reality (carried from §30)

Standing up a board is easy; **running a public board is a permanent moderation, spam/abuse, and security commitment** regardless of who builds it. Native means we own that load directly — but we also own the data, the boundary, and the stack, with no off-Cloudflare host to patch. Mitigations baked into v1: login-gated posting/voting (Better Auth — no anonymous write), admin moderation tooling from day one, and the display-name boundary limiting personal exposure.

## 9. What this round produces (and what it does not)

- **Produces:** this design spec; an amendment to **ADR-0044** (native build supersedes the Fider lean); a §30 white-paper note that the forum is a native `@magna-carta/community` package.
- **Does not:** ship any package, schema migration, Worker route, or UI. Implementation is a future slice, deferred until Fable is available again, with its own plan.

## 10. Decision summary

1. **Native build** on Cloudflare (control-plane D1 + Cloudflare email), **superseding the deferred-Fider lean** — Fider's Postgres/SMTP/AGPL and missing changelog/roadmap make it the wrong fit; the data model is small enough that native is less work than operating it.
2. **Clean, extractable package** `@magna-carta/community`, isolated from the per-firm DAL — the isolation enforces the confidentiality boundary and keeps a future repo-split cheap.
3. **Feedback board now** (requests + upvote + comments + status pipeline + roadmap-by-status view), **with a dormant `discussion` seam** for an open forum later.
4. **Display-name identity** — real name/firm never shown publicly; aggregate vote counts only; admins see the real account for moderation.
5. **The loop is subscriber-carry + Cloudflare-email notify on ship**, never auto-authored prose — preserving ADR-0048's version-accuracy by construction.
6. **Product-updates surface (ADR-0048) is unchanged** and remains standalone-buildable; the board is the requests/votes/discussion half it links into.
