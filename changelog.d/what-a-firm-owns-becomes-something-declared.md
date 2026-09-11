---
category: Added
audience: internal
---

**`firm-resources.ts` — the one declaration of what a firm owns, because it cannot be discovered.**

A firm's record spans four things created at different moments by different code: control-plane rows,
a SQLite Durable Object, an R2 bucket, and possibly a managed natural-language search instance. None
of them can be enumerated from outside. There is no API that lists Durable Object instances, none
that maps a bucket back to its firm, and `ai_search_instance` is deliberately the sole index of the
instances. So the set can only be DECLARED, and anything missing from the declaration is invisible to
everything that walks it.

That is not hypothetical: writing the platform reset by hand missed the search instances entirely.
They would have been left running and unnameable against an account ceiling of 5,000.

Ordering is part of the declaration rather than a detail of any one caller. `destroyOrder` puts the
control plane last because it is the index of everything above it, and the tests pin the properties
that make a walk safe — control plane last, every orphanable resource strictly before it, positions
unique — so a caller that walks the list in order is correct by construction. Offboarding, a
data-subject export and the reset script read one list instead of three drifting copies.

What is not built yet, and is named in the file: a fitness scan that fails a per-firm resource
provisioning creates and the manifest never hears about, on the model of the PII/erasure registry's
attribution function.
