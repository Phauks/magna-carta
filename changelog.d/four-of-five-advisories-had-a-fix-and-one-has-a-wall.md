---
category: Security
audience: internal
---

**Five HIGH advisories that turned the governance job red on every branch are cleared, one by a bump and four by removing a carrier.** On 2026-09-02 osv-scanner began reporting four advisories on fast-uri 3.1.5 (host confusion and server-side request forgery through URI normalization, CVSS 7.5 each) and one on @faker-js/faker 5.5.3 (`helpers.fake` code execution, CVSS 7.8) against a lockfile identical to `main`'s, so no pull request could merge past a failure none of them caused.

fast-uri is fixed in 3.1.6; the override in `pnpm-workspace.yaml` moves to 3.1.7. It reaches the tree only through ajv, whose declared range already admits that line, so nothing else resolves differently.

faker had a wall. Its sole carrier, postman-collection, hard-pins 5.5.3 through its newest release and reads the v5 API at module load, so forcing the fixed line (10.5.0, a different major) makes the package throw on require. postman-collection reached the lockfile only through the Prism mock server's HTTP layer, and nothing in the repository ran Prism: no script, tool, test, plugin or workflow, and the "Prism mock smoke" the API conventions described lived in a workflow file that does not exist. So `@stoplight/prism-cli` leaves `apps/api-worker`, and with it postman-collection, faker 5.5.3, and uuid, whose override existed only for that carrier. The mock server stays available on demand (`pnpm dlx @stoplight/prism-cli mock …`, documented in `docs/conventions/api.md`) without living in the audited tree. The lodash override remains as a floor. Spectral, the contract lint the gate actually runs, is untouched.
