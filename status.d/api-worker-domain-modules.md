---
slice: API worker domain modules
group: cross-cutting
order: 45
research: done
spec: done
plan: in-progress
built: todo
ui: n/a
load-profile: n/a
tested: todo
branch: claude/adoring-ride-fe94q5
active-work: docs/active-work/claude/adoring-ride-fe94q5.md
next: Owner review of the module grouping; then step 1 of the migration plan (bindings module, the domain-app constructor, the four fitness tests against today's tree)
link-spec: docs/specs/2026-09-18-api-worker-domain-modules-design.md
link-plan:
adrs:
blocked-by:
---

The worker's 99 flat route files become about twenty domain modules behind a manifest; contract shapes move to the domain packages; an HTTP-versus-background seam and four fitness tests hold the shape. Design proposed 2026-09-18; the migration plan is section 10 of the spec.
