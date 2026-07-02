---
number: 113
slug: ai-inference-tenant-isolation
status: Accepted
date: 2026-06-19
area: AI / Inference
summary: "Tenant-isolation hard constraints: caching disabled for all firm-data inference, firm metadata derived not caller-supplied, authenticated gateway, authoritative response-captured token-usage metering in the firm-scoped data-access layer (never gateway logs)."
---

**Tenant-isolation hard constraints: caching disabled for all firm-data inference, firm metadata derived not caller-supplied, authenticated gateway, authoritative response-captured token-usage metering in the firm-scoped data-access layer (never gateway logs).**

**Context:** AI Gateway's default cache key is `SHA-256(provider + endpoint + model + provider-auth-header + body)`; under Unified Billing the auth header is Cloudflare-managed and identical across firms, so the default key carries no firm dimension — two firms sending a byte-identical prompt could collide on a cache hit. Gateway spend limits are best-effort/eventually-consistent and gateway log storage is capped with drop-on-full, so billing must not derive from gateway logs. Firm metadata in the binding `gateway.metadata` map fails open if omitted/wrong (the request still runs, mis-metered) — not structural isolation unless enforced in the implementation.

**Decision:** (1) `skipCache: true` is pinned in the binding `gateway` options on every request; caching may be enabled for a non-privileged utility path only if the cache key's first component is the firm id — and the gotcha is recorded: setting `cf-aig-cache-key` alone caches for ~5 minutes even when gateway caching is off, so the firm-scoped key is mandatory wherever a cache key appears at all. (2) Firm metadata is derived in the implementation from the firm-scoped call context; callers may not supply it; keys are opaque ids only (`firm_id`, `slot`, `env`, future `matter_id`), capped at 5, never client/matter text; the redundant `model` tag is dropped. (3) The authenticated `AI` binding is the only gateway path — no raw `cf-aig-authorization` token appears in any firm-reachable config. (4) Per-request token usage is captured from the inference response at the implementation boundary and written through the firm-scoped data-access layer as the authoritative, durable, firm-isolated, reconcilable metering record; it feeds the existing firm-usage diagnostics surface (ADR-0103).

**Fitness tests:** caching-off (no cacheable request without a firm-scoped cache key); derived-firm-metadata (every request carries a derived non-empty `firm_id`, ≤5 keys, no `model` tag).

**Builds on ADR-0110** (confidentiality posture), **ADR-0003** (tenancy isolation), **ADR-0103** (firm-usage diagnostics). Spec: [`docs/specs/2026-06-17-ai-inference-foundation-design.md`](../specs/2026-06-17-ai-inference-foundation-design.md).
