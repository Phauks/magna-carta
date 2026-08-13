---
slug: community-board-is-a-named-cross-firm-exception
status: Accepted
area: Community surfaces / Tenancy
date: 2026-08-13
summary: "The community board is a NAMED, ARGUED EXCEPTION to the firm-scoped data-access rule, not a surface that happens to sit outside it. Its records live in control-plane D1 as `community_*` tables, they carry a `firm_id` on every authored row, and votes aggregate across firms — which is the exact shape the tenancy rule forbids in the per-firm lineage. The exception is granted on four grounds: the board holds no firm business data, only statements about the software written for an audience that includes every other firm; the firm identifier is an aggregation and moderation key that is rendered NOWHERE, and is captured at write time because membership changes make it unrecoverable later; per-firm storage would make the board REQUIRE the cross-firm read it is trying to avoid, since every list would fan out across the fleet; and the isolation the per-firm database boundary normally supplies is replaced by three structural substitutes rather than by care — a deployable (`apps/community-worker`) that binds no per-firm resource, a package (`@magna-carta/community`) that cannot import the firm-scoped data-access layer, and a projection chokepoint whose public types have no field for a firm or an account. What is given up is stated plainly: this is the one surface on the platform that does not fail closed by being unable to see another firm. The exception is scoped to `community_*` and licenses nothing else — in particular it does not license reading firm data INTO the board, which is why the confidentiality detector is format-only."
---

**The community board takes a named exception to the firm-scoped data-access rule, and the
exception is argued here rather than assumed.**

**Context.** The platform's deepest habit is that all business data goes through the firm-scoped
data-access layer and no query crosses firms, with the per-firm database boundary doing the work.
The public changelog that shipped before this board sat outside that rule **by having no business
data in play rather than by taking an exception to it**, and recorded deliberately that the two
community surfaces to follow would be genuinely cross-firm and would need a real exception argued on
its own terms. This is that argument.

The board is cross-firm in three separate ways, and none of them is incidental. **Votes aggregate
across firms** — the ranking figure is how many separate firms want a thing. **A post by a member of
one firm is read by members of every other firm and by the public** — that is the surface's purpose,
not a side effect. **Status is platform-wide** — one request has one position on one roadmap.

**Decision.**

1. **The board's records live in the control-plane database**, as tables prefixed `community_`:
   profile, post, vote, comment, flag, moderation action, and the post-number sequence pair. Not
   per-firm, not a third database.

2. **`firm_id` is written on every authored row and rendered nowhere.** It is the key the ranking
   counts distinctly, the key the write limits are bucketed by, and the key that bounds report
   abuse. It is captured at write time because firm membership changes, so it cannot be recovered
   from the author's account later. No read path returns it and no public type has a field for it.

3. **The isolation normally supplied by the per-firm database boundary is replaced by three
   structural properties, each of which is a deployment or a type rather than a discipline.**

   - **`apps/community-worker` binds the control-plane database and one key-value namespace, and
     nothing else.** No Durable Object namespace, no bucket, no service binding into the application
     worker. A firm's matters, ledgers and documents are not merely un-queried from the board; they
     are unreachable. That is the same kind of guarantee the per-firm boundary gives — a property of
     what the code can reach, not of what it chooses to ask for — obtained from the deployment.
   - **`@magna-carta/community` declares its own minimal SQL interface and imports no per-firm
     module.** A fitness test in that package fails the build on an import of the firm-scoped
     data-access layer, on an import of the per-firm schema or any per-firm domain package, and on
     SQL that names a per-firm table.
   - **One projection module builds every reader-facing shape.** The firm identifier and the account
     handle are not optional fields a handler may omit; they are absent from the public types, so a
     handler cannot leak them by forgetting. The response schemas are strict, so an unexpected key
     fails rather than ships.

4. **The exception is scoped to `community_*`, read and written by `@magna-carta/community` from
   `apps/community-worker`, and licenses nothing else.** In particular it does **not** license
   reading firm data _into_ the board. The detector that looks for client detail in a post body works
   on format alone and never consults the author's own Directory or matter list — checking a post
   against a firm's own client names would be precisely the cross-firm read this arrangement exists
   to make impossible, and the worker could not perform it in any case.

**Why not per-firm storage.** It inverts the problem rather than solving it. A post written in one
firm's database and read by every other firm makes each list read a fan-out across the whole fleet,
and makes the distinct-firm vote count a genuine cross-firm aggregate query — the thing the rule
forbids, performed for real, on every page load. Per-firm storage would make the board _require_ the
violation.

**Why not a third database.** A separate lineage would give a stronger boundary than a table prefix,
and it was seriously considered. It is rejected because every write on this board has to be joined
to the `user` and `firm` rows to know whether the author may post at all, and those live in the
control plane; a third database would either duplicate platform identity or perform a cross-database
read on every write. The control plane is already the platform-level, cross-firm store — the firm
registry is cross-firm data by definition — so the board is in the lineage whose whole purpose
matches its shape.

**What is given up, stated plainly.** The per-firm database boundary is the strongest confidentiality
control the platform has, and this surface does not have it. Everywhere else, a bug fails closed
because the code cannot see another firm's data. Here, the substitutes in point 3 are what hold, and
they are strong but they are not the same thing. That cost is why the surface carries the narrowest
data it can: no matter, no client, no ledger, no document, no per-firm identifier of any kind beyond
`firm_id` itself, and a body whose only author is a member deliberately writing in public.

**What one firm can therefore learn about another.** A display name, which is the member's real name
by default or an account-level pseudonym if they set one; a badge, if the platform awarded one; and a
stable author reference that is the community profile's own handle rather than the account's. **Not
the firm** — never, not by default and not by opt-in, because firm plus practice area plus question
is the inference path and a name alone is not. **Not who voted** — aggregate counts only, and the
distinct-firm count only once at least five firms are represented, because "two firms want this" on a
post signed with a real name identifies the second firm. **Not what a post used to say** — there is no
revision table, so a member who realises their post said too much can make the original unreadable.
**Not that a post was hidden** — a hidden post is absent rather than replaced by a placeholder, since
a marker is a sign pointing at the one post somebody thought might name a client.

**Portal principals are excluded structurally rather than by a check.** A community profile is keyed
on a `user` row, and a firm's external portal client is not one, so there is no path for a portal
principal to acquire a board identity. The failure mode being avoided is specific: a portal
principal posting on this board would disclose a firm-client relationship, which is the one
disclosure this platform can least afford.

**Consequences.** The board is the only place in the repository where a reviewer must think about
cross-firm reachability rather than rely on it being impossible, so the three structural properties
in point 3 are load-bearing and each is guarded by a test. A future surface that wants cross-firm
data does not inherit this exception; it argues its own, and the fact that this one was granted is
not evidence for the next.

**Considered & rejected:** **per-firm storage with a cross-firm read path** (makes the violation
mandatory and puts it on every page load); **a third database lineage** (a stronger boundary bought
with duplicated platform identity or a cross-database read on every write); **routes on the
application worker** (public reads of member-authored content should not share a blast radius with
the application, and the package boundary is far stronger as a property of what a deployable can
reach than as a lint rule); **rendering the firm even as an opt-in** (firm plus practice area plus
question is the inference path, and an opt-in makes declining to disclose a signal); **a public voter
list** (the reference product has one and it is findable by search, which is the demonstration
rather than the precedent); **weighting a vote by what a firm pays** (per-seat cost scaling in
different clothes — the firm identifier keeps the reversal available without taking it); **consulting
firm data to detect client names in a post** (the cross-firm read the exception explicitly does not
buy); **a tombstone where a hidden post was** (re-publishes the interesting part of a suspected
disclosure). Extends the tenancy and isolation decision, whose rule this names an exception to, and
the public-changelog decision, which deferred this argument to here. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../specs/2026-08-11-community-surfaces-design.md).
