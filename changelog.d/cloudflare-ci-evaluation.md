---
category: Added
---

**Research: can the quality gate run on Cloudflare instead of GitHub Actions?** A per-job evaluation of
`.github/workflows/gate.yml` against Cloudflare Workers Builds, written from the primary documentation
tree and from measured gate-run data. The recommendation is to keep the gate on GitHub Actions and keep
deploys on Workers Builds: the two platforms are each already running the half they are built for, and
a migration would move about a tenth of the bill. Workers Builds' 20-minute build timeout and 8 GB
memory ceiling each independently disqualify the type-aware lint job — 26 minutes measured at its cheap
tier and 43% of a run's billable minutes — and there is no job graph, matrix, artefact passing,
arbitrary caching, merge-commit trigger, or aggregate required status to build a gate out of. Records
two findings worth keeping regardless: Workers Builds ships an **undocumented Docker daemon** that the
deploy pipeline already depends on for the Rust-to-WASM builds and every Container image, and GitHub's
own **$0.002/minute Linux 1-core runner** is a 3x rate cut on the gate's short jobs for a one-line
change per job. Research only — no decision, no configuration changed.
