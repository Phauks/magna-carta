---
worktree: (primary checkout)
area: Matter parties — the read half of a link the API can only write
status: building
touches: packages/directory, apps/worker/src/routes/directory.ts, apps/web matters/[id]/parties, roadmap.d/core-domain.md
---

A directory entity can be linked to a matter in a role through `POST /api/v1/directory/matter-parties`
and there is no endpoint that reads one back. `readMatterParties` is production code — the conflicts
checker calls it — and no route mounts it. Nothing anywhere sets `matter_party.deleted_at`, which
five readers filter on, so a party linked by mistake is permanent. `MatterPartyRow` omits the
`capacity` column that `linkMatterParty` writes.

This stream adds the read and the unlink, carries capacity through the shared row type, and builds
the matter Parties section over them (it is a nineteen-line stub today).
