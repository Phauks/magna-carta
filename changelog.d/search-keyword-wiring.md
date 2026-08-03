---
category: Added
---

**Discovery keyword search — the catalog-to-engine wiring.** The app Worker can now run a keyword search
over a matter's live corpus end to end (short of the engine Container itself): `runKeywordSearch` resolves
the matter's live splits from the per-firm catalog through the firm-scoped data-access layer, hands their
R2 object keys to the `SearchIndexPort`, and returns the ranked hits. Firm scoping and catalog
enumeration stay in the Worker behind the data-access layer, so the engine is a stateless range-reader
that only ever sees splits the firm's own catalog named. `resolveSearchIndexPort` returns a
service-binding adapter to the dedicated search worker (`magna-carta-search`) when its binding is present,
and a deferred port (`engine-not-implemented`) when it is absent — every test environment and production
until that worker is deployed — exactly as the conversion subsystem is wired-but-dormant. The adapter
never throws: a non-2xx or transport failure becomes a first-class adapter error. Covered by tests for
the catalog-to-engine split-key hand-off, the deferred fallback, and the adapter's forward/parse and
error mapping.
