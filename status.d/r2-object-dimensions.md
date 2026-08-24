---
slice: R2 object dimensions (matter + object class in object metadata)
group: cross-cutting
order: 34
research: done by="Opus 5"
spec: n/a
plan: n/a
built: done by="Opus 5"
ui: n/a
load-profile: n/a
tested: done by="Opus 5"
branch: main
active-work:
next: Stamp the `client` dimension once the matter-to-client link has a reader — the backfill sweep fills it in for what already exists at no extra cost
link-spec:
link-plan:
adrs: ADR-0254
blocked-by:
---

`@magna-carta/object-dimensions` — the two dimensions every object in a firm's bucket carries (`matter` on matter-scoped objects, `object_class` on all of them) and the closed class vocabulary behind them. Stamped at put time by every write path: the presigned PUT signs the metadata headers, so a browser upload that drops one is refused rather than landing an unscopeable object; the multipart create carries them (a multipart object's metadata is fixed there); a version cut inherits its source's matter and only changes class; firm-level objects (bundles, templates, letterheads, conversion artifacts, staged mail, the content-addressed email original) record the class and deliberately no matter. `dimension-backfill-sweep.ts` repairs what predates the stamp on the daily storage pass — candidates come from the R2 listing rather than any new schema, bounded per firm and convergent over failures, and it doubles as the standing detector for a write path that forgets. `apps/api-worker/test/r2-object-dimension-scan.test.ts` is that guard in the suite. `client` and `confidentiality_scope` are reserved and written by nothing.
