---
branch: slice-2-2-editing
worktree: C:/dev/magna-carta-worktrees/slice-2-2-editing
area: Slice 2·2 — in-app .docx editing (Collabora on Containers), versioning, Standard→IA tiering, optimistic concurrency + reconciliation
status: building — Task 4 (magna-carta-edit worker) code-complete; remainder is deploy-gated
touches: apps/worker/src/editing, apps/worker/wrangler.jsonc, apps/magna-carta-edit, containers/collabora, packages/database, packages/access-control, packages/file-manager, packages/fixtures, STATUS.md, ROADMAP.md, docs/decisions/pending/collabora-editing-host-topology.md, docs/decisions/pending/container-subsystems-extract-to-dedicated-workers.md
---

# HANDOVER (2026-06-25, Opus 4.8)

Full state lives in the memory note `slice-2-2-editing-status.md` (read it first — it has every decision + gotcha). This is the short, actionable version.

## Where it stands

- Slice 2·2 **backend is feature-complete + adversarially reviewed** (all 17 findings fixed). The **measurement spike is run + torn down**; findings folded into the ADRs.
- **Task 4 (`apps/magna-carta-edit`) is code-complete + green** (6 commits since the spike teardown; tip `f16083e`). The coolwsd editing compute is extracted to its own browser-fronted worker.
- **All local-buildable work is done.** Everything remaining needs a real deploy (the CI/Workers-Builds container spike) or is the owner's merge decision.
- Verified: edit-worker 5 · app-worker edit-session 3 · database 89 · file-manager 103 · `vp check` 0 errors · `wrangler deploy --dry-run --containers-rollout=none` validates the worker + bindings + container config.

## Remaining activities

1. **Live container deploy via the CI / Workers-Builds spike (THE gating step).** Build the ~2 GB `containers/collabora/Dockerfile` image on Cloudflare's network and deploy `magna-carta-edit`. Local Docker is unavailable (same constraint scan/convert have), so this only happens on Cloudflare. **Validate live:** that coolwsd accepts an **http `WOPISrc` over the runtime outbound interception** (the one config the Collabora docs do not pin down — `aliasgroup1=http://wopi.magna-carta.internal:80`); that the WOPI callback reaches the app worker through `outboundByHost` → `APP_WORKER`; cold-start + post-sleep reconnect.
2. **`*.edit.<domain>` cookieless wildcard route** — deploy infra (a custom wildcard domain). The worker keys the per-document container off the Host's first label; `EDITOR_ORIGIN_DOMAIN` env feeds the editor-launch URL builder. Until the route exists the editor origin is not reachable.
3. **Right-size the instance** — `wrangler.jsonc` ships `standard-1` (4 GiB) as headroom over the spike's 1.16 GiB idle floor. Measure the **open-document peak against the real WOPI host** (the spike could not load docs) and drop to a custom ~2–2.5 GiB instance to cut provisioned-memory cost.
4. **Re-sync main before merging** — the branch is **~105 behind main** again (main moves fast; pdf-engine + others merged this session). Sync before any merge. The last sync's playbook (migration renumber, wrangler dup-key consolidation) is in the memory note.
5. **Pre-merge gate + merge** — owner-raised bar: the exhaustive multi-agent adversarial review was done once; re-run before merge, then merge (owner's call). NOT pushed.

## Must respect (gotchas)

- **`WOPI_HOST = "wopi.magna-carta.internal"`** is duplicated in `apps/worker/src/editing/edit-session-route.ts` AND `apps/magna-carta-edit/src/document-editor-container.ts` — keep them identical.
- **No alarm keep-alive** — liveness rides the editor WebSocket natively (`@cloudflare/containers` ≥0.3.7; #147 fixed). An alarm keep-alive is unnecessary + rides the open spinloop #191, and pins provisioned-memory billing 24/7. Sleep on disconnect.
- **Editing snapshots predate main's `0021` financial tables** — regenerate via drizzle-kit before the next editing-schema `drizzle-kit generate` on this lineage (snapshots gate no test/runtime, so it is latent). Per-firm head is `0024`.
- **Latent main bug fixed on this branch only:** main's `apps/worker/wrangler.jsonc` has duplicate `durable_objects`/`migrations`/`services` keys (drops bindings on the deployed worker). Consolidated here; main itself still has it until this branch merges. Deployed DO-migration history needs reconciling before a prod deploy.
- **No users yet** — production bugs are acceptable for now (owner's call), so the wrangler bug isn't being hot-fixed on main separately.
- Container workers can't run under the local test pool (Container class pulls `cloudflare:workers`) — keep edit-worker unit tests on pure modules (`document-routing.ts`), as done.
