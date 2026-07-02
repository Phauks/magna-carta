# @magna-carta/whois — local notes

Worker-consumed RDAP/WHOIS lookup package. Given a domain name or IP address, it queries the
registration record and returns a `RegistrationResult`. RDAP is the primary path; port-43 raw
WHOIS is the fallback for registries that have not yet adopted RDAP.

All outbound effects (HTTP calls, TCP socket connections, DNS resolution) arrive through the
injected `WhoisDeps` interface — the worker supplies real implementations; tests pass fakes.
There is no global `fetch` or `connect` call anywhere in this package.

**SSRF invariant (local, enforced here).** The target is user-supplied. Every entry point that
accepts a user-supplied target MUST call `assertPublicTarget` (from
`@magna-carta/integrations/safe-target`) before making any outbound connection. Never pass an
unvalidated target to `WhoisDeps.http`, `WhoisDeps.socket`, or `WhoisDeps.resolve`.

The orchestrator (added in a later task) wires `lookupDomain` and `lookupIp` together behind the
worker route. `src/lookup.ts` (added in a later task) is the public entry point.
