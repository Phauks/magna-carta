---
category: Security
---

Dependency audit — three new HIGH advisories are remediated by version, not accepted. `quick-xml`
moves 0.38 to 0.41 in `crates/discovery-core`, the discovery engine's OOXML and OpenDocument text
walk. 0.41.0 is the release that fixes both RUSTSEC-2026-0194, where the start-tag
duplicate-attribute check cost `O(N²)` byte comparisons so a single crafted tag could pin a core for
minutes, and RUSTSEC-2026-0195, where namespace resolution allocated one binding per `xmlns`
declaration with no upper bound, inside the reader and before the consumer ever saw the event. The
first is directly reachable here: the spreadsheet walk iterates a cell's attributes, and this
engine's whole input is files an opposing party chose. `js-yaml` moves to the 3.15.1 and 4.3.1
backports for GHSA-5p4m-2wfm-xmqj, whose `!!omap` key-uniqueness check is quadratic on the default
schema, so a plain `load` of untrusted YAML blocks the event loop for the whole document. The
earlier quick-xml acceptance is not re-opened — it left this repository when its carrier was
replaced, and the carrier today is a different one that arrived with the discovery core. There is
still no accepted Rust advisory.
