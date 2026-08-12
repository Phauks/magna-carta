---
slice: Directory pronouns
group: cross-cutting
order: 36
research: n/a
spec: n/a
plan: n/a
built: done by="Opus 5" gap
ui: todo
load-profile: n/a
tested: todo
branch: main
active-work:
next: Owner review of the pull request, then the Directory pronoun surface (presets plus free-form entry)
link-spec:
link-plan:
adrs:
blocked-by:
---

Owner override of the shipped no-pronoun-helper default: optional owner-entered pronouns on `directory_person` (the whole declension plus verb agreement, all-or-nothing at the table CHECK, never derived from a name), a `PUT …/persons/{id}/pronouns` route, and the `pronoun()` / `pronounVerb()` template helpers whose unrecorded case renders they/them. No gender field ships — flagged for the owner. Load profile `[-]`: six columns on a row two existing batched reads already join, no new read. UI deferred.
