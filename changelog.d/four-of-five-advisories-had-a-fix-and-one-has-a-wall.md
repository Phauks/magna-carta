---
category: Security
audience: internal
---

**The fast-uri override moves from 3.1.5 to 3.1.7.** On 2026-09-02 four advisories were published against the 3.1.x line below 3.1.6 (host confusion and server-side request forgery through URI normalization, CVSS 7.5 each), and the governance job began failing for every branch on a lockfile identical to `main`'s. fast-uri reaches the tree only through ajv, whose declared range already admits 3.1.7, so the bump is the override line and its lockfile entry and nothing else resolves differently.

The fifth finding, on @faker-js/faker 5.5.3 (`helpers.fake` code execution, fixed only in 10.5.0), has no override remediation: its sole carrier is postman-collection, which hard-pins 5.5.3 through its newest release and reads the v5 API at module load (`faker.address.city`), so forcing the fixed line makes the package throw on require. That carrier arrives through the Prism mock server's HTTP layer alone, never Spectral. The remaining choice, an accepted entry in `osv-scanner.toml` or dropping the mock server, is the owner's.
