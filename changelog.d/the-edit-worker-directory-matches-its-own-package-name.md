---
category: Changed
audience: internal
---

**`apps/magna-carta-edit` is now `apps/edit-worker`.** The directory disagreed with the package
inside it, which has always been `@magna-carta/edit-worker`, and with every sibling's
`<thing>-worker` shape. Renaming it is the whole change: paths updated in the two tsconfig solutions,
the root `vite.config.ts` test project list, the CI gate's test-node package list,
`tooling/lint-test-collection`, the deploy and build-performance runbooks, two `roadmap.d/` evidence
lines, and the cross-references from the worker's editing area and the search worker.

**The deployed Worker keeps the name `magna-carta-edit`** — that is a Cloudflare script name and
renaming it would orphan the deployment. Only the source directory moved. Its Workers Builds **root
directory must be repointed to `apps/edit-worker`**, or the build cannot find the package.

Historical records are left as written: `CHANGELOG.md` and the two 2026-07-01 review documents cite
the old path because that is where the code was when they were written.
