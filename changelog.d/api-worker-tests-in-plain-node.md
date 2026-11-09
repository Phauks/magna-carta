---
category: Changed
audience: internal
---

**The api-worker tests that never reach the Workers runtime now run in plain Node, and test and type-check memory have explicit ceilings.** A test file that declares `// @node-runtime` in its header runs in a second project, `apps/api-worker/vitest.node.config.ts`, with no workerd VM and no whole-app preload. That preload cost about 25 s of setup per file and most of the suite's 6.4 GB peak. The first 68 files to opt in run together in about 9 s. The other test projects share a ceiling of eight workers (`MC_TEST_MAX_WORKERS`) instead of one per CPU, and `tsc -b` runs with a 4 GB heap instead of Node's default, which is sized from system memory. On a 15 GB machine that default is 2,096 MB, against a measured peak of 1,943 MB. Measurements and reasoning: `docs/conventions/build-performance.md`, under "Test memory".
