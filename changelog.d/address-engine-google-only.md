---
category: Removed
audience: internal
---

**Address suggestions run on Google Places alone.** The owner chose Google as the only address
engine on 2026-11-20, so the platform's own US address index (`apps/address-worker`,
`containers/address`, `crates/address-core`) and the Smarty adapter are removed, along with the
routed port, the primary-office region bias, the `ADDRESS_SERVICE` binding type and the Smarty
secrets. System Status no longer lists `magna-carta-address`, and Address Suggestions is set up by the
Google key alone. The runbook's address sections are rewritten (operations, sections 19 and 20).
