---
slice: API worker domain modules
group: cross-cutting
order: 47
research: done
spec: done
plan: done
built: in-progress
ui: n/a
load-profile: n/a
tested: todo
branch: claude/adoring-ride-fe94q5
active-work: docs/active-work/claude/adoring-ride-fe94q5.md
next: Step 3 of the migration plan (the http/ and background/ split with the boundary enforced); owner review of the firm and files groupings before step 4 starts on them
link-spec: docs/specs/2026-09-18-api-worker-domain-modules-design.md
link-plan:
adrs:
blocked-by:
---

The worker's 99 flat route files become about twenty domain modules behind a manifest; contract shapes move to the domain packages; an HTTP-versus-background seam and four fitness tests hold the shape. Design proposed 2026-09-18; step 1 (the foundations and the four fitness tests) built 2026-09-19; step 2 (the domain directories, the manifest, the per-domain operation lists) built 2026-09-20; the migration plan is section 10 of the spec.
