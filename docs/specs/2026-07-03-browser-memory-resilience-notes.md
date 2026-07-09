# Browser memory (OOM) resilience — pickup notes

**Status:** notes only, no code changes. Written 2026-07-03.
**Scope:** the _client_ SPA falling over on big data — not Worker/Container OOM (that's a separate surface with its own guards, e.g. the PDF decompression-bomb guard and `runIngest`'s single-read tee).

Audit-then-act was the intent. The audit result flipped the plan: the expensive-to-retrofit
foundations are **already built and enforced**, so what remains is small and better landed _with_
its first consumer than as empty seams now. This note records the verified state so nobody
re-audits, and lists the remaining work with the trigger that should pull it in.

## The SPA surfaces that can OOM a tab

- Per-matter document/file lists — discovery sets run to thousands of rows (`packages/file-manager`).
- In-tab PDF/document viewing — a single discovery PDF can be hundreds of MB (`packages/pdf`).
- Long financial grids — time/ledger/billing/costs (`timekeeping`, `ledger`, `billing-core`, `costs`).
- Client-side search / the shared doc-discovery WASM core — WASM linear memory grows and never shrinks (the nastiest one).
- Bulk select + bulk ops; uploads; client-side exports.

## Already built — do not rebuild

The "prevent by construction" layer is mostly done, and guarded as invariants rather than convention:

| Foundation                  | Where                                                                                                  | Note                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyset/cursor pagination    | `packages/data-access/src/cursor-pagination.ts`; contract in `apps/worker/src/contracts/pagination.ts` | Uniform opaque-cursor envelope, `DEFAULT_PAGE_SIZE = 50`, `LIMIT pageSize + 1` has-more probe. Lists are paged, not unbounded.                                                                                                          |
| Streaming ingest / upload   | `packages/file-manager/src/ingest-core.ts`                                                             | `runIngest` tees one stream (head→magic-byte sniff, full→`DigestStream`+scan); _"a multi-GB object never buffers."_ Bytes bypass the Worker (direct-to-R2 presigned), so the browser streams a `File` body — never `readAsArrayBuffer`. |
| Streaming download / export | `packages/file-manager/src/zip-composition.ts` + `BundleBuildCoordinator` DO                           | Bulk ZIP streams R2→`client-zip`→R2 multipart; over `liveMaxFileCount`/`liveMaxTotalBytes` it hands off to a background build and returns 202.                                                                                          |
| Virtualization primitive    | `packages/design-system/src/lib/internal/virtual-list.svelte`                                          | Windowed list over `virtua`; already wired into Combobox.                                                                                                                                                                               |
| Bounded bulk selection      | `packages/file-manager` (`zip-composition.ts`, `upload-policy.ts`)                                     | Selection→entries resolved server-side; live thresholds cap inline vs. background.                                                                                                                                                      |

## Genuine gaps + when to build them

1. **Virtualization not wired into `data-table`.** `packages/design-system/.../data-table/table-body.svelte`
   renders all row children — no windowing. Pagination caps pages at 50, so this only bites if a
   surface deliberately renders thousands of rows unpaged.
   **Trigger:** the first unpaged/long grid. Reuse the existing `internal/virtual-list.svelte`
   primitive; budget for stories + VRT baselines + a11y/fitness gates (the data-table lives under
   the strict design-system apparatus — see `packages/design-system/CLAUDE.md`).

2. **Detect layer — absent.** No `navigator.deviceMemory` / `hardwareConcurrency` budget, no
   `performance.measureUserAgentSpecificMemory()` reading, no memory-pressure event in
   `packages/telemetry`.
   **Do NOT build now** (empty seam, no producer/consumer — cuts against YAGNI / "build when in the
   area"). **Trigger:** lands _with_ the first heavy surface (paged PDF viewer or first big grid).
   Two design decisions to make then:
   - A per-device-tier memory budget helper (`deviceMemory` low → smaller PDF-preview ceiling, etc.).
   - A memory-pressure telemetry event through the standard error pipeline (golden rule 4;
     `packages/telemetry/src/events.ts`) so we learn which firms/surfaces actually hit it.
   - **Prerequisite for `measureUserAgentSpecificMemory()`:** cross-origin isolation (COOP/COEP) —
     the same gate as `SharedArrayBuffer` / WASM threads. Worth an ADR when the WASM search/doc core
     lands in-browser; it has real integration cost (every cross-origin asset needs CORP/credentialless).

3. **Recover layer — absent.** No top-level `<svelte:boundary>`, no IndexedDB autosave, no lite-mode.
   The web app is still nearly empty (`apps/web/src/routes/{+layout,+page}.svelte`), so there's little
   to wrap yet.
   **Cheapest greenfield foundation when app structure exists:** a root `<svelte:boundary>` that
   catches a render/OOM crash and drops to a lightweight fallback wired to the error pipeline
   (golden rule 4), plus a `lite-mode` store later heavy surfaces read (previews off, force
   server-side render/export, smaller pages). Every future surface inherits it.
   **Trigger:** first real app shell / first form-heavy or preview-heavy route.

## The two items that hurt most if deferred

Architectural, not additive — flag for dedicated attention when the doc-discovery/search core moves in-browser:

- **WASM / doc-discovery-core memory model** — run it in a _terminable_ Web Worker, fresh worker per
  heavy job so linear memory is actually reclaimed (WASM heap never shrinks). Also keeps it off the
  main thread (golden rule 10).
- **Cross-origin isolation (COOP/COEP) decision** — gates the live pressure API + `SharedArrayBuffer`
  - WASM threads; make it once, deliberately (ADR).

## If picking this up

Fastest re-entry: this note + `packages/data-access/src/cursor-pagination.ts` +
`packages/file-manager/src/ingest-core.ts` confirm the prevention layer; then choose from the gaps
above by which heavy surface is next on the roadmap.
