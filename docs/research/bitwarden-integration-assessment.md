# Bitwarden Integration — Scoping Assessment

**Date:** 2026-06-17
**Scope:** What it would take to add a Bitwarden integration to Magna Carta — the prerequisite framework work, the three viable Bitwarden products/paths, the encryption tension that constrains the design, and a recommended path.
**Purpose:** Decision-ready assessment. The white paper (_Plugin / Add-on system_) names Bitwarden as the candidate launch adapter for a future "password manager / secrets vault" port but marks the scope **TBD**. This document resolves that TBD into a concrete A/B/C choice and recommends one. It is research, not an accepted design — it graduates to a spec + ADR once a path is chosen. Nothing here is built or committed.

---

## 1. Summary

Bitwarden is not one integration. It is **three different products with three different auth and encryption models**, and the one the white paper actually wants — surfacing shared firm logins backed by the firm's existing vault — is the hardest of the three to build, because Bitwarden's Password Manager vault is end-to-end encrypted and there is no server-side way to read login passwords without the user's master password.

Two independent conclusions:

1. **Bitwarden should not be the first credentialed adapter.** Whatever path is chosen, it depends on credentialed-adapter machinery that is currently a designed-but-unbuilt seam. Email/calendar was always meant to be the adapter that forces that machinery into existence against a better-understood (OAuth) model. Making Bitwarden first means it inherits all of that cost on top of its own.
2. **The white paper's "scope TBD" is really the A/B/C choice in §5.** Picking it is a product decision, not an engineering one, and it should be made before any build.

## 2. What already exists (and what does not)

The ports-and-adapters framework and a credential-store seam are **built on the `parcels-states-batch-2` branch but not yet merged to `main`** (`main` has no `@magna-carta/integrations` package). This needs to merge regardless of Bitwarden.

**Built (interfaces + seams):**

- `@magna-carta/integrations` — `CredentialStore` / `TokenRefresher` / `ConnectionStore` interfaces, the connection model + health state machine (`nextHealth`), registry + typed `Dispatch`, capability descriptors, the canonical/`raw`/zod boundary.
- `packages/data-access/src/firm-secret-credential-store.ts` — a thin bridge adapting a `SecretStore` (`getSecret`/`putSecret`) to `CredentialStore`. The commit is literally titled "firm_secret-backed CredentialStore **seam**."
- The `integrationConnection` identifier type in `@magna-carta/identifiers`.

**Not built (the real backing — prerequisite for _any_ credentialed adapter):**

- **(a) The real `firm_secret` store (slice 1·2).** No `firm_secret` table exists in any migration (`0000`–`0006`). The credential-store bridge wraps a `SecretStore` interface with nothing real behind it. This is envelope-encrypted, `firm:manageSecrets`-gated storage (ADR-0084).
- **(b) The `integration_connection` D1 repository.** Only the in-memory `ConnectionStore` interface and the ID type exist — no table, no per-firm repository.
- **(c) Worker connect / connection-management routes** (connect an account, view health, re-auth, disable) — currently unowned (ROADMAP _Pending UI surfaces_).
- **(d) The token-refresh Durable Object** (single-writer refresh lock).
- **(e) A non-OAuth `Credential` variant.** `Credential` is OAuth-only today (`{ accessToken?, refreshToken, expiresAt? }`). None of Bitwarden's auth shapes fit it.

(a)–(e) are the deferred seam from the integration-port design (STATUS line 59; ADR-0091/0092), scheduled to be built with the first credentialed (email/calendar) adapter.

## 3. The three Bitwarden products, mapped to intent

| Product | What it can access | Auth model | Serves "surface shared logins"? |
| --- | --- | --- | --- |
| **Public API** (org API key, `organization.ClientId`) | Org **management** only — members, collections, groups, policies, event logs | API key, `client_credentials`; Teams/Enterprise only | **No.** It cannot read vault item passwords at all. |
| **Vault Management API / CLI** | Actual vault items, incl. passwords | Personal API key (`user.clientId`) **+ `bw unlock` with the master password** | Yes — but only with the master password (see §4). |
| **Secrets Manager** | Machine secrets in a **separate** SM vault (not the login vault) | Machine-account **access token**; SDK decrypts client-side | No — it is a different vault; serves programmatic app secrets, not staff logins. |

## 4. The central tension (the crux)

The white paper wants to **"surface shared firm logins… backed by the firm's existing vault."** But the Password Manager vault is end-to-end encrypted, and Bitwarden states plainly that **the API key is not a substitute for the master password** — programmatic vault access requires a `bw unlock` that derives the decryption session key. There is **no server-side way** for a Magna Carta Worker to read a firm's login passwords without one of:

- **(a) Holding the firm's master password server-side** — a catastrophic liability that breaks both Bitwarden's and Magna Carta's zero-knowledge posture. Effectively a non-starter.
- **(b) Key Connector** — organization-managed decryption keys served via SSO, which removes the master-password requirement. But it is **Enterprise-only and self-hosted-only** (a Docker component on the firm's network, holding RSA-wrapped user keys). A heavy per-firm prerequisite that cannot be assumed.
- **(c) Client-side decryption** — run Bitwarden's `sdk-internal` (Rust core, `bitwarden_wasm_internal` WASM bindings) in the browser/Tauri client so plaintext never touches the server. This fits the zero-knowledge model and is **architecturally on-brand** — Magna Carta already ships a Rust→WASM core (Tantivy / doc-discovery). But it **breaks the "every integration is its own server-side Worker behind a port" uniform-isolation model**: a client-side adapter is a genuinely new shape for the framework.

So the recorded intent is the **most expensive and most architecturally disruptive** of the options. That is the finding worth surfacing before anyone commits.

## 5. The three build paths

- **Path A — Secrets Manager adapter (cleanest fit, least aligned with intent).** A machine-account access token is stored in the `firm_secret` store; the SDK retrieves and decrypts server-side. Slots into the credentialed-adapter machinery almost exactly as designed — no master-password problem. **But** it serves infrastructure secrets, not staff logins, and it **partly overlaps Magna Carta's own `firm_secret` store** (the "why not just use our own encrypted secret store?" question is real). Separate paid add-on; machine-account caps (20 Teams / 50 Enterprise).
- **Path B — Org / Public API adapter (cheap, shallow).** Surfaces org structure — collections, members, groups, event logs — in the Tools area. Server-side, API-key, no encryption tension, fits the existing machinery. **But** it shows metadata, never passwords, so it likely underwhelms against what "Bitwarden integration" implies to a user.
- **Path C — Client-side vault adapter (true to intent, hardest).** The `sdk-internal` WASM client-side-decryption route from §4(c). Delivers the actual staff-login experience and fits zero-knowledge, leveraging existing WASM-core competence. **But** it is a new client-side adapter shape, a new credential model, and the most work — and feature parity (golden rule 6) means it must work in both web and Tauri.

## 6. Recommendation

**Sequence:** Do **not** build Bitwarden first. Build email/calendar as the first credentialed adapter so it pays down prerequisites (a)–(e) against the better-understood OAuth model, then revisit Bitwarden once the machinery is proven and merged.

**Path, when the time comes: Path C (client-side vault adapter), with Path B as an optional cheap precursor.** Reasoning:

- Path C is the **only path that delivers the recorded intent** (shared firm logins surfaced in-app). A and B do not.
- The client-side-decryption constraint is **not a workaround but the correct architecture** — it preserves zero-knowledge, which a legal practice-management platform handling privileged data should not compromise, and it aligns with the existing Rust→WASM competence.
- Path B can ship first as a low-cost "connected / org-health" surface in the Tools area if a visible Bitwarden presence is wanted before the full Path C build — it reuses the server-side machinery and throws nothing away.
- Path A is only worth doing if a **separate, infrastructure-secrets** need emerges; it does not serve the staff-login intent and overlaps the firm's own secret store, so it should not be conflated with "the Bitwarden integration."

**Decision required before any build:** ratify A vs. B vs. C as an ADR (extending ADR-0015 / ADR-0092), and confirm the email/calendar-first sequencing. The framework's `Credential` type will need a non-OAuth variant either way (e.g. an access-token credential for A, vault-unlock material handled client-side for C).

## 7. Rough effort & risk (relative, pre-spec)

| Item | Effort | Risk / notes |
| --- | --- | --- |
| Merge the framework + credential-store seam to `main` | Low | Already built; needs review + merge. |
| Prerequisites (a)–(e) — real `firm_secret` store, connection D1 repo, worker routes, refresh DO, `Credential` variant | High | Shared with email/calendar; should be charged to that slice, not Bitwarden. Gates on slice 1·2 for (a). |
| **Path A** adapter on top of prerequisites | Low–Medium | SDK integration, access-token credential, server-side. Licensing: separate paid add-on. |
| **Path B** adapter on top of prerequisites | Low | Org-management reads only; no decryption. Public API gated to Teams/Enterprise. |
| **Path C** adapter | High | New client-side adapter shape; `sdk-internal` WASM in web + Tauri; vault-unlock UX; feature parity. Largest design surface. |

## 8. Open questions for the spec

- Which path (A/B/C) — the §6 decision, ratified as an ADR.
- For Path C: how unlock material is held in-session (never at rest server-side), and the web/Tauri parity story.
- How vault items link to Directory / matter entities (the white paper's other TBD) — only relevant once a vault-reading path (C) is chosen.
- Self-hosted Bitwarden / Vaultwarden compatibility, if firms run their own vault ("backed by the firm's existing vault").
- Licensing assumptions: Public API and SCIM are Teams/Enterprise-gated; Secrets Manager is a separate paid add-on. Confirm against target-firm plans.

## Sources

- [Password Manager APIs](https://bitwarden.com/help/bitwarden-apis/) · [Bitwarden Public API](https://bitwarden.com/help/public-api/) — Public API is org-management only; vault items need the Vault Management API.
- [CLI Authentication via API Key](https://bitwarden.com/help/personal-api-key/) — the API key is not a substitute for the master password; `bw unlock` derives the decryption key.
- [Secrets Manager Overview](https://bitwarden.com/help/secrets-manager-overview/) · [Access Tokens](https://bitwarden.com/help/access-tokens/) · [Secrets Manager SDK](https://bitwarden.com/help/secrets-manager-sdk/) — machine accounts, access tokens, SDK decryption.
- [About Key Connector](https://bitwarden.com/help/about-key-connector/) · [Deploy Key Connector](https://bitwarden.com/help/deploy-key-connector/) — Enterprise + self-hosted only; org-managed decryption keys remove the master-password requirement.
- [Internal SDK](https://contributing.bitwarden.com/architecture/sdk/internal/) · [`bitwarden_wasm_internal`](https://sdk-api-docs.bitwarden.com/bitwarden_wasm_internal/index.html) · [`bitwarden/sdk-internal`](https://github.com/bitwarden/sdk-internal) — Rust core with WASM bindings for client-side operations.
- [Secrets Manager Plans](https://bitwarden.com/help/secrets-manager-plans/) · [Password Manager Plans](https://bitwarden.com/help/password-manager-plans/) — Public API/SCIM gated to Teams/Enterprise; Secrets Manager a separate add-on (machine-account caps 20 Teams / 50 Enterprise).
