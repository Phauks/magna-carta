---
category: Added
audience: internal
---

A shared harness for concurrency verifiers, `@magna-carta/data-access/interleave`: it runs a competing writer at a named point inside the operation under test — before its nth commit, or once a named read has resolved — so the window between a precondition read and its commit is opened deliberately instead of depending on how two promises happened to interleave. Its `runInterleaved` entry point throws when that point was never reached, so a concurrency test whose competing writer never ran fails instead of quietly passing as a single-caller test. Replaces the per-package copy in the matters tests, and is applied to the fee ledger's freeze, the cost ledger's billing lock, and the retroactive re-rate.
