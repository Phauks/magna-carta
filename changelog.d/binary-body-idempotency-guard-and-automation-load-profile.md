---
category: Changed
---

**A raw-bytes request body can no longer be paired with the required-idempotency gate — the platform
refuses the combination rather than trusting anyone to remember.** The gate fingerprints a request by
reading its body through a cache that decodes it as text, so bytes that are not valid UTF-8 do not
survive the round trip: an emailed `.msg`, an image, or any other binary upload would reach the handler
with every invalid sequence replaced, and a route that stored it as the firm's verbatim original would
store a corrupted copy that matches nothing. Every route on the API was audited for the pairing and
none had it — all 105 operations that require an idempotency key carry a JSON body or no body at all,
and all ten that take raw bytes already honour the key in their own handler, against the bytes they
actually received. What is new is that the hazard is now unreachable: a route declaring both fails at
startup with the reason and the supported alternative named, and two contract checks in the build back
that up — one over the published API description, one over the route sources, so a route that reads a
body raw without declaring one is covered too.

**The document-automation volume profile.** The synthetic-data harness now models a firm's template
catalogue — templates with their version history and archived tail, the confirmed field-name mapping
library, the assembly records filed documents leave behind, and a matter carrying a full party list and
a full set of the firm's own fields. Four operations are measured against it: listing the catalogue
part-way through, resolving a template's current version, building a whole merge context for the widest
template a firm's field set can produce, and reading the field catalogue the merge fields are derived
from. Every one of them reads through an index at volume, and the merge context is the measurement that
holds the line that matters: filling in a document costs the same number of database reads whether the
template has two merge fields or a hundred.
