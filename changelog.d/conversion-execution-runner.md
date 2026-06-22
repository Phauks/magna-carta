---
category: Added
---

**Conversion — the multi-hop execution runner.** `@magna-carta/conversion` can now _run_ a conversion, not just plan it: `runConversion(from, to, bytes)` finds a path through the registry and executes it hop-to-hop, threading each step's output into the next and returning the converted bytes or a typed failure — a missing path is an unsupported edge, and a deferred engine mid-chain surfaces `engine-not-implemented` without running later hops. Single-hop image conversions run end-to-end today via the libvips adapter; multi-hop chains light up the moment their engines land with the execution substrate.
