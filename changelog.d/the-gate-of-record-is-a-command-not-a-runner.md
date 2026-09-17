---
category: Changed
audience: internal
---

**The whole-repo quality gate is `pnpm gate`, run on the machine that made the change, and the GitHub
Actions workflow that used to be it is gone.** The account's Actions minutes ran out on 2026-08-05,
again on 2026-09-03, and each time the required `gate` status stopped reporting: every pull request
wedged behind a check that had not run and merged on an administrator override, so the gate failed
closed on the budget and open on the code. `tooling/gate/index.mjs` now runs the same dimensions from
one command — format, governance, the pinned osv-scanner audit over both supply chains, the WASM
artefacts, the type-check, the four contract-drift checks, the type-aware lint over the affected
closure (sinks included, nothing deferred), the Rust and container gates where the change reaches
them, the test-collection floor and the full `pnpm test` — with the workflow's own path classification
deciding which have an input, `--plan` printing the decision, and a summary block the pull-request
template now asks for in place of the label. `gate.yml`, `seed-caches.yml` and `lint:cache-keys` are
deleted; `assemble-docs.yml` no longer dispatches a gate onto its assembly branch;
`lint:test-collection` keeps its collection floor and drops the partition proof that only a sharded
split needed; `lint:lints` reads the fitness-sweep step off the gate's own step list instead of YAML;
`lint:affected-scope` drops its verbatim-invocation check because the gate calls the classifier
directly. One owner step remains and is on the deploy queue: remove `gate` from the `main` ruleset's
required status checks, or GitHub keeps waiting for a check nothing will report.
