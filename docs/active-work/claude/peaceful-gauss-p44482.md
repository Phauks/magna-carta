---
worktree: /home/user/magna-carta
area: Discovery's screens take the product's search and create controls, and the search is served on the server
status: building
touches: packages/discovery/src/review-reads.ts, packages/discovery/test, packages/fixtures/src/load-profile, apps/api-worker/src/routes/discovery.ts, apps/api-worker/src/routes/discovery-review-reads.ts, apps/api-worker/openapi/openapi.json, apps/api-worker/test, apps/web/src/lib/discovery, apps/web/src/routes/(app)/discovery, apps/web/test, packages/design-system/src/lib/components/data-table/index.ts, docs/user/features, changelog.d
---

Brings the discovery surface onto the two controls every other list screen uses — `ScreenSearch` on
the register, the document list and Loads, and one `CreateControl` on each screen that creates — and
makes every one of those searches a server-side narrowing rather than a filter over the page in hand.

On the server it is one new optional filter per listing, in `packages/discovery/src/review-reads.ts`:
the document list over `source_name`/`source_path`, both review-set listings over `name`, the loads
listing over `source_description`, each a LIKE scan placed after every clause that can use an index,
with one shared `likePattern` escaping the reader's own wildcards. Signatures gained a trailing
optional argument, so the access-scoped read registry and its visibility fitness pass are unchanged.
`openapi.json` is regenerated — the usual touch-overlap with any stream adding a route.

On the web the document search is a BUILT criteria provider (`search`) rather than a control beside
them, so it rides the address and composes with the other filters; providers gained `setFrom` for the
two whose control is not the narrowing popover. `NewReviewSetDialog` gained `chooseMatter` and a
caseload matter picker, which is what lets the firm-wide register create.

The one narrowing with no index behind it is measured rather than argued: the load-profile harness
runs the matching and the no-match case at both volumes, and both numbers sit in the read that pays
them (0.4 ms and 62 ms at the 250,000-document ceiling).

The only shared-package edit is one line in the data table's `index.ts`. An earlier commit on this
branch added `grid-search.ts` there for client-side row matching; moving all three searches to the
server left it with no consumer, so this commit removes it again — a stream that wants a client-side
grid search should take it from that commit's history rather than assume it is on `main`.
