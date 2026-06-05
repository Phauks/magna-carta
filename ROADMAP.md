# Roadmap

The **living** execution tracker — what's in progress, what's next, what just shipped. It breathes with the work and is updated in the same PR as the work (a definition-of-done item; see [`docs/conventions/documentation.md`](docs/conventions/documentation.md)).

This is **not** the white paper's _Build roadmap_, which is the stable **phase strategy** (Phase 0–7 and rationale). This file tracks **execution against** those phases and does not restate them. Shipped work is detailed in [`CHANGELOG.md`](CHANGELOG.md); decisions in [`docs/Decision-Log.md`](docs/Decision-Log.md); subsystem detail in [`docs/specs/`](docs/specs/).

## Now — current focus

- **Phase 0 — Foundation** — **slice 0·2 (§9 data primitives).** Walking skeleton shipped (slice 0·1); now building the §9 data-convention layer: the `money` module, the id-generator + prefix registry, idempotency middleware, the transactional outbox + relay, and the Drizzle schema + fleet-migration runner (ADR-0061–0065; spec in [`docs/specs/2026-06-04-foundational-data-conventions-design.md`](docs/specs/2026-06-04-foundational-data-conventions-design.md)).

## Next

- Phase 0 build-out per the white paper's _Build roadmap_: Cloudflare scaffold (control-plane + per-firm D1, R2, Queues, Workers), Better Auth + RBAC skeleton, append-only ledger core, telemetry baseline, fixtures harness.
- The API implementing-library spike (record result as an ADR; detail in [`docs/conventions/api.md`](docs/conventions/api.md)).

## Recently shipped

- **Phase 0 slice 0·1 — walking skeleton** shipped (commits ef318f9…39eb4ea; ADR-0069, ADR-0070; spec in [`docs/specs/`](docs/specs/)): monorepo + `vp` toolchain, Hono Worker serving the SvelteKit SPA + `/api/health` → control-plane D1, Miniflare integration test, CI through `wrangler deploy --dry-run`.
- **Foundational data & runtime conventions** (§9.3–9.7) designed and decided: money representation, identifier strategy, idempotency, the transactional outbox, and the schema-migration / fleet model (ADR-0061–0065; spec in [`docs/specs/2026-06-04-foundational-data-conventions-design.md`](docs/specs/2026-06-04-foundational-data-conventions-design.md)). With the time model (ADR-0055) and durability-on-close (ADR-0057), all of §9 is now settled — the cross-cutting data primitives Phase 0 builds on.
- Documentation foundation: white-paper reorganization, ADR standard + Decision Log, `CLAUDE.md`, conventions, specs/user scaffolds, roadmap + changelog.

## Backlog — subsystems awaiting a spec

Marked `> Needs development.` in the white paper (by area, not section number); first candidates for the design → spec → build cycle:

- **Access control / RBAC & ethical walls** — white paper, _Authentication, access control & encryption_
- **Conflicts matching engine** — _Conflicts Check_
- **Rules-based docketing** — _Calendar and rules-based docketing_
- **Tasks & workflows / matter plans** — _Tasks and workflows / matter plans_
- **E-signature** — _Payments and e-signature_
- **Client intake / CRM** — _Client intake / CRM_ (now includes the receptionist call-intake capture flow, _Communications layer_)
- **Communications layer — messaging + voice** — _Communications layer_ (messaging/telephony plugin ports, Telnyx launch adapter, in-house Workers AI transcription, two-way client texting, receptionist call intake; carrier decided in ADR-0047, subsystem spec pending)
- **Notifications subsystem** — _Notifications_ (designed in the white paper + ADR-0059: a notification-type registry separating decision from delivery, the in-app notification center, channel fan-out through the Communications ports, and durable-rows realtime with a per-user-push seam. The _Tasks and workflows_ escalation and _Calendar and rules-based docketing_ reminder Needs-development notes now route through it. Pending: the full type catalog, the raise-seam inventory, and the in-app-center UI archetype.)
- **Community & feedback forum** — _Community & feedback forum_ (wanted; tool/build deferred — leaning self-hosted Fider; ADR-0044 _Proposed_)
- **Inbound large-file upload path** — _Matters and File Manager_ (direct-to-R2 via presigned PUT / R2 multipart so bytes bypass the Worker's ~100 MB body / 128 MB memory limits; resumable uploads for flaky connections / large discovery & video ingest; per-firm max-size/content-type policy via the Settings registry. The symmetric inbound counterpart to the streamed bulk-download and signed-URL preview paths; likely its own ADR. Upload malware scanning is the related _Hardening_ item below.)

### Hardening (seamed now, executed when upstream is ready)

- **Untrusted file handling (sandboxing + malware scanning)** — uploaded bytes (File Manager, _Client portal_, _Discovery_ ingest) are untrusted; a malicious file is inert at rest, so risk arises only on **process / serve / forward**. **Primary defenses are structural and built anyway** with conversion + preview, tracked in their feature homes — not deferred: **(1) sandbox-hardened processing** (no-egress `enableInternet=false`/allowlist, least-privilege-per-job, ephemeral Containers, resource caps — _Performance & concurrency model_) defeats server-side RCE in our native parsers (the only threat aimed at _us_); **(2) safe delivery** (separate cookieless sandbox origin + CSP + `<iframe sandbox>` + safe-rendition preview, never raw active formats — _Inline file preview_) defeats stored XSS. Per-firm isolation caps cross-tenant blast radius. **Malware scanning is the thinner, deferred layer** (mainly downstream-recipient protection + compliance/cyber-insurance), built as a **swappable port now, engine later** — _borrow outside expertise, never outside custody_ (commercial engine on our own compute yes; data-holding SaaS no, per ADR-0030/ADR-0038). Scan pipeline: pre-acceptance gates (size/type allow-list, magic-byte check, decompression-bomb guards) → quarantine-on-arrival (R2 event → Queue; not servable until cleared) → scan (verdict as metadata) → optional CDR rendition (original preserved for evidence) → re-scan sweep on signature updates → **quarantine, never auto-delete** (infected files are evidence; destruction blocked by holds). Engine options behind the port, by data custody: WAF content scanning (edge Layer-0 — detect-only, 50 MB cap, Enterprise, misses direct-to-R2/at-rest); commercial engine in a Cloudflare Container (Sophos/Bitdefender/MetaDefender — single engine fits ~12 GiB/instance); managed in our own cloud account (AWS GuardDuty / bucketAV-Sophos — solves the large-file cap but needs an off-Cloudflare ingest bucket); ClamAV + premium unofficial sigs + YARA (cheap baseline; needs a `cvdupdate` private mirror; falls back behind the ~2 GB cap). Files past the scannable cap get an explicit _unscanned_ policy; desktop (Tauri) local pre-scan is the parity accelerator. Its own ADR. (_Matters and File Manager_; tied to the inbound-upload backlog item above.)
- **Telemetry analytics tier (Iceberg-on-R2)** — register the redacted Logpush-in-R2 logs as **R2 Data Catalog** Iceberg tables for zero-egress DuckDB/Spark/BI querying, with compaction + snapshot-expiration maintenance (_Observability and diagnostics_ → _Telemetry analytics tier_, ADR-0056 _Proposed_). Analytics Engine remains the MVP path; the seam sits on data already written. Adopt when a trigger binds — retention past ~92 days, exact/unsampled counts, rich joins / external engines, or cost-at-scale — and re-verify the open-beta limits (Parquet-only, ~2 GB/table/hr, orphan-file cleanup) at that point.
- **Post-quantum signature migration** — passkeys/WebAuthn + the PAdES e-signature seal → ML-DSA/SLH-DSA, and a PQC-capable external-KMS-rooted KEK (_Encryption and key management_, ADR-0046). Seamed today via algorithm-versioning; gated on upstream standards (FIPS 204/205/206, COSE, ETSI PAdES, CA support). Verify Cloudflare hybrid PQC TLS is on for every hop and log any plugin endpoint that won't negotiate it.

## How this stays current

Updated in the same PR as the work. The future propose-only **docs-maintenance agent** (white paper, _Maintenance agents_; ADR-0058) can roll completed items up from the changelog and flag drift between the planned phases and reality — propose-only; authoring stays in-commit.
