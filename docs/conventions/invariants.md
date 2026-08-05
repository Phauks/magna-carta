# Invariants

**Status:** Active. The **domain invariants** — hard correctness constraints tied to a specific subsystem. Violating one is a bug regardless of what was asked.

These are **scoped, not universal:** each binds only when you work in its area. Broad, cross-cutting rules — UI/design system, data access, error & bug logging, documentation, feature parity, reuse-before-building — are **golden rules** in the root [`CLAUDE.md`](../../CLAUDE.md), not here. Each code area's local `CLAUDE.md` restates the invariants that apply there, so they surface in context. Each cites its white-paper area and the ADR that set it.

## Money & accounting

- **Append-only ledger & audit.** Never mutate or delete a ledger or audit row; corrections are new, balancing entries. (_Financial Core_; ADR-0008)
- **Balanced entries on leaf accounts.** Every ledger entry has ≥ 2 same-currency lines whose debits equal credits, posted to active leaf accounts only (parents are roll-ups); line amounts are always positive — direction is data, never a sign. (_Financial Core_; ADR-0072)
- **Materialized balances are derived state.** `account_balance` rows update only inside the posting batch and must always equal the recomputed sum of lines (fitness query); bounds violations abort the whole batch. (_Financial Core_; ADR-0072, prepares ADR-0009)

## Trust

- **No-negative trust balance.** A client trust ledger can never go negative. Enforced by `min_balance_minor = 0` on every matter leaf and the `account_balance` bounds CHECK, which aborts the whole posting batch — never by an application-level balance comparison, which cannot be atomic without an interactive transaction. (_Trust accounting_; ADR-0009, ADR-0072)
- **Postings land on matter leaves; roll-ups carry no balance.** The trust tree is trust-account liability root → client node → matter leaf. A parent's stored `account_balance` stays at zero forever, so a client-side or account-side total is a `SUM` over descendant leaves and is never read from a parent row. (_Trust accounting_)
- **No commingling, and fees never touch trust — one composition guard owns both.** An entry touching a trust account may touch nothing outside it: not another trust account, not an operating bank, not an income or expense account. Trust/IOLTA deposits therefore land gross and a processor or bank fee has nowhere to sit on a trust entry at all — it debits the operating account as a separate entry by construction. `@magna-carta/trust`'s `composeTrustEntry` is the only supported way to build a trust entry; billing's apply-funds path and the payments card rail inherit the rule by calling it. (_Trust accounting_, _Payments_; ADR-0032)
- **One client per entry.** A movement between two clients' trust ledgers is refused outright — it is the classic misappropriation pattern and at the entry level is indistinguishable from one. Two matters of the same client remain expressible. (_Trust accounting_)
- **Everything hung off the ledger inherits its append-only discipline.** Holds and transfers are append-only (database triggers); a release is a new linked row, never an edit or a status column. (_Trust accounting_; ADR-0008)
- **Available balance is the disbursement ceiling.** Available is the stored balance minus active holds; a positive balance whose disputed portion is under hold is not money the firm may pay out. (_Trust accounting_)
- **A jurisdiction fact refuses rather than falling back.** An unresearched or unencoded jurisdiction field never resolves to a baseline, and "no jurisdiction recorded" and "this jurisdiction is not encoded" stay distinct refusals. (_Trust accounting_; ADR-0009)

## Matters & numbering

- **A matter number is frozen at assignment, unique per firm.** It is drawn when a matter opens (a prospective consultation has none) and never changes except by a deliberate renumber; a partial UNIQUE index on `matter_number` is the concurrency backstop, so two simultaneous draws yield distinct numbers. (_Matters and File Manager_; ADR-0079)
- **Closed is archived-but-additive.** A closed matter still accepts documents; closing runs the named close-precondition registry first (the Financial Core registers the zero-balance rule later). (_Matters and File Manager_; ADR-0080)

## File Manager

- **The quarantine gate is a status gate enforced by reads.** Every `file_version` read filters `status = 'clean'` (and `deleted_at IS NULL` for default lists) — a pending or quarantined version is never servable; quarantine is a status, never a key scheme. A source-scan fitness function rejects any `file_version` SELECT without a status predicate. (_Matters and File Manager_; ADR-0081)
- **Versions are immutable; soft-delete only.** A committed version's bytes and metadata never change — a new version is a new row and a new R2 key; files soft-delete, versions are untouched. (_Matters and File Manager_; ADR-0077)
- **R2 keys are opaque and server-minted.** Object keys are `files/{fileId}/{versionId}`, never derived from a client-supplied path; the bytes flow direct-to-R2 and never transit the Worker. (_Matters and File Manager_; ADR-0081)

## Secrets & encryption

- **`protected()` for sensitive fields.** Encrypt/role-gate/audit sensitive identifiers via the DAL `protected()` field type — never hand-rolled crypto, never plaintext secrets in core tables. (_Encryption & key management_; ADR-0026)
- **Secrets never leave core; plugins isolated.** Each integration is its own Worker behind a typed port; it receives plaintext at call time and never sees key material. (_Plugin system_; _Encryption & key management_; ADR-0015, ADR-0026)

## Protected fields / encryption

- **Decrypt = permission check + audit row, inseparable and fail-closed.** A protected read checks the field's decrypt permission first (absent → refuse, no decrypt, no audit), then commits the `protected.decrypt` audit row **before** any plaintext is returned — a failed audit write means no plaintext. (_Encryption & key management_; ADR-0084, ADR-0026)
- **No plaintext path outside the chokepoint.** Every protected column is written via `composeProtectedWrite` and read via `readProtected`; no other code reaches a sealed value in the clear. Enforced by the no-plaintext-escape source scan. (_Encryption & key management_; ADR-0084)
- **Envelope, AAD, and key versioning are frozen — a change is a new version.** The ciphertext frame `[algo_version | key_version | iv | AES-256-GCM]`, the AAD string `mc:aad:v1|firm|table|field|row_pk|versions`, the HKDF info/salt constants, and the blind-index `"1:"` prefix are pinned by golden vectors; evolving any of them adds a new version read alongside the old, never edits it. (_Encryption & key management_; ADR-0084, ADR-0046)
- **Normalization transforms are frozen.** The blind-index normalization (digit-strip, uppercase-strip, state-prefix) is a frozen contract — changing one moves which values collide, so it is a new `indexName` (new subkey), never an edit; the decrypt-reindex cost is a documented maintenance job. (_Encryption & key management_; ADR-0084)
- **Non-extractable keys end to end.** Every key handle — root KEK, the unwrapped per-firm HKDF base key, every derived purpose/index key — is `extractable: false`; raw bytes enter only at mint/import and never surface. (_Encryption & key management_; ADR-0084, ADR-0046)
- **Crypto-shred is permanent unreadability.** Nulling a firm's `wrapped_firm_key` destroys the only path to every key derived from it, so the firm's entire protected corpus becomes permanently unreadable (reads fail closed); it commits with a `firm.key_shredded` audit row and invalidates the per-isolate key cache. (_Encryption & key management_; ADR-0084, ADR-0026)

## Outbound requests (SSRF)

- **Every user-supplied outbound target must pass `assertPublicTarget` before any fetch or render.** This applies to the WHOIS query subject, the safe-browse URL, every redirect hop encountered during a redirect-probe, and any future feature that performs a Worker-side fetch to a user-supplied address. `assertPublicTarget` lives in `@magna-carta/integrations/safe-target`. Rules it enforces: `http`/`https` schemes only (no `file:`, `ftp:`, or custom schemes); the **resolved IP** must be public — loopback (`127.0.0.0/8`, `::1`), RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, including the cloud-metadata endpoint `169.254.169.254`), unique-local IPv6 (`fc00::/7`), and all other IANA-reserved ranges are rejected. The check is on the **resolved IP, not the literal string**, to defeat DNS-rebinding inputs. (_Websites & Domains tools_; enforced by `@magna-carta/integrations/safe-target`)
- **The investigated URL or host is never logged.** When `assertPublicTarget` rejects a target, or when any outbound call fails, the rejected or failing address is **not** included in the error body, response headers, or logs. A correlated error ID is surfaced to the user; the target is recorded only in the internal correlation trace. The subject of an investigation may be present in privileged matter context. (_Error logging and redaction_; ADR-0017, ADR-0038)

---

> Data access (firm-scoping through the DAL) and redact-by-default error logging used to live here; they are **core**, so they are now golden rules in [`CLAUDE.md`](../../CLAUDE.md). The `protected()` chokepoint above _is_ part of the data-access layer, but the rule "encrypt sensitive fields" is specific enough to stay a domain invariant.
