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
next: Step 4 continues one domain per pull request (directory, custody, billing next); owner review of the firm and files groupings before their turn
link-spec: docs/specs/2026-09-18-api-worker-domain-modules-design.md
link-plan:
adrs:
blocked-by:
---

The worker's 99 flat route files become about twenty domain modules behind a manifest; contract shapes move to the domain packages; an HTTP-versus-background seam and four fitness tests hold the shape. Design proposed 2026-09-18; step 1 (the foundations and the four fitness tests) built 2026-09-19; step 2 (the domain directories, the manifest, the per-domain operation lists) built 2026-09-20; step 3 (the http/ and background/ split, boundary enforced) built 2026-09-24; step 4 begun the same day with the calendar contract moved to its package; the migration plan is section 10 of the spec.
