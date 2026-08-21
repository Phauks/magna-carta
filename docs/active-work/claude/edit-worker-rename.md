---
worktree: /home/user/magna-carta
area: apps/magna-carta-edit renamed to apps/edit-worker
status: building
touches: apps/edit-worker, tsconfig.build.json, tsconfig.test.json, vite.config.ts, .github/workflows/gate.yml, tooling/lint-test-collection, docs/conventions, roadmap.d, changelog.d
---

A directory rename with no behaviour change. `apps/magna-carta-edit` held a package named
`@magna-carta/edit-worker`, so the directory disagreed with its own package and with every sibling.

The one thing that does NOT move is the Cloudflare script name, which stays `magna-carta-edit`:
renaming that would orphan the deployment rather than rename it. The consequence is a dashboard step
— the Workers Builds root directory has to be repointed at `apps/edit-worker` — recorded in the
deploy runbook's entry for the Worker.
