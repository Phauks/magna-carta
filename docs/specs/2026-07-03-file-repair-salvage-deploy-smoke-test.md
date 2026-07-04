# File Repair & Salvage — post-deploy smoke test

The automated suite covers the worker logic against **stubbed** services (the recovery container and the malware scanner are fakes in the test pool). This checklist is the **first real end-to-end verification**: a deployed corrupt file going worker → real container → `recovery-core` → R2 → real ingest → (real scan) → matter. Run it once after the branch merges and Cloudflare Workers Builds has built and deployed the container. It turns "tests pass" into "we have seen it work."

## Prerequisites

- [ ] Branch merged to `main`; **Cloudflare Workers Builds has built `containers/recovery`** on push. This is the first time that image ever builds — confirm the build succeeded (it validates the repo-root `image_build_context` + the `crates/` workspace COPY that only the in-cloud build can prove).
- [ ] `apps/recovery-worker` deployed; the app worker's `RECOVERY_SERVICE` service binding resolves to it.
- [ ] A **test firm** provisioned: per-firm database with migrations through `0036_file-repair-provenance` applied, and an R2 bucket bound (`env.R2`).
- [ ] A user in that firm holding **both** `tools:fileRepair` and `files:upload` (the Owner/Admin role has both after seed `0035`). Have a second user with only ONE of the two for the permission checks.
- [ ] A **matter + folder** in the test firm to attach into (note their ids).
- [ ] For the quarantine check only: the **scan engine deployed** (`SCAN_SERVICE`). Without it, output is `unscanned` and passes — quarantine cannot be exercised until the scan container is live (memory: scan scales to zero / re-add at first firm).

## Test inputs (keep a small fixture set)

- A truncated or CD-stripped **ZIP / .docx** (recoverable).
- A **PDF with a broken cross-reference** (recoverable).
- **Junk with an embedded JPEG/PNG** (carve target).
- A file with **known, deliberate damage** where you know exactly what should be lost — for the crown-rule honesty check.

## A. Stateless surface (no persistence)

1. [ ] `POST /api/v1/file-repair/diagnose` (body = corrupt PDF) → **200**, a report with a plausible `recoverability` + `repairSupported`. _Proves the whole app → container → engine round trip is live._
2. [ ] `POST /api/v1/file-repair/repair` (corrupt-but-recoverable file) → **200**, `{ files, loss }`. Download `files[0]`, open it, confirm it is usable.
3. [ ] **Crown-rule honesty check (the important one):** using the known-damage fixture, confirm the `loss` manifest is _truthful_ — `fullyRecovered` is `false` when data was actually dropped, and the lost/synthesized items match what you know was damaged. The tool must never report a lossy reconstruction as complete.
4. [ ] `POST /api/v1/file-repair/carve` (junk + embedded jpeg) → **200**, one or more carved files that actually decode.
5. [ ] Oversize input (> the firm's inspectable-size cap) → **413**; empty body → **400**.

## B. Attach-to-matter (persistence)

6. [ ] `POST /api/v1/file-repair/repair/attach?matterId=<M>&folderId=<F>&fileName=recovered.pdf` (corrupt file) → **202** `{ fileId, versionId }`. Then confirm, after ingest runs:
   - the file appears in matter `<M>` folder `<F>`, its version committed (`clean`/`unscanned`);
   - a `file_repair_provenance` row exists for `versionId` with the honest manifest (query the firm DB, or a future provenance read surface);
   - a `file.repaired` audit event fired for `versionId` carrying **counts only** (no file names/content).
7. [ ] `POST /api/v1/file-repair/repair/attach?matterId=<M>&fileId=<existing>` → **202**; confirm it becomes a **new version** of `<existing>` (version number increments), not a new file.
8. [ ] `POST /api/v1/file-repair/carve/attach?matterId=<M>&folderId=<F>` (junk + embedded files) → **202** `{ files: [...] }`; confirm **N new files** in `<F>`, each with a provenance row and a `file.carved` audit.

## C. Security & isolation

9. [ ] Repeat B-6 as the user **without `tools:fileRepair`** (but with `files:upload`) → **403**. And as the user **without `files:upload`** → **403**. Both gates must refuse.
10. [ ] `POST /api/v1/file-repair/carve/attach?matterId=<M>&folderId=<folder-in-a-DIFFERENT-matter>` → **404** (not a 500, not a silent mis-file). Confirms the folder-matter validation.
11. [ ] **Quarantine (needs the scan engine):** attach a reconstruction that scans malicious (e.g. an input that repairs to contain the EICAR test string, or temporarily point the scan at a rule that flags a known fixture). Confirm the version ends **`quarantined`**, is **not downloadable**, and its `file_repair_provenance` row **still exists** (chain of custody on the withheld reconstruction). _Note: hard to trigger with an ordinary benign-corrupt file, since repair of a clean-but-damaged file yields clean output — this path is already proven by the automated `handleIngestMessage` test; the deploy check is mainly to confirm the real scan engine participates._
12. [ ] **Log-safety spot check:** force an error (e.g. recovery engine down → the route returns 503). Confirm the Problem response + the logs carry only a stable code + user-facing Error ID — **never** file bytes, file names, or a scan signature.

## Pass criteria

- A/B/C green, and specifically: **(3)** the manifest is honest on the known-damage fixture, **(6)** provenance persists with the real manifest, **(10)** cross-matter is refused, and **(11/12)** nothing malicious or private leaks.
- Record the Workers Builds image build result and any first-deploy surprises back into `docs/active-work/` or the relevant status.
