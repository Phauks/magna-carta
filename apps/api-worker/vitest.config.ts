import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { nodeRuntimeTestFiles } from "./vitest.node-runtime.ts";
import {
  billingPackageSources,
  documentAssemblyFormFixtures,
  pdfCoreFixtures,
  sqlAsText,
} from "./vitest.plugins.ts";

// Stub for the magna-carta-scan service binding in tests — no real scan worker runs under the
// local pool, so the service binding must resolve to something or workerd refuses to boot.
// The stub branches on the request path so both the scan route and the file-type identify route
// receive honest responses. /scan returns the no-engine RawScanResult (an honest unscanned, never a
// fake clean); /identify returns a fixed Magika jpeg result so the file-type tests can assert on the
// report shape without running the real Container.
const SCAN_SERVICE_STUB_SCRIPT = `
export default {
  async fetch(request) {
    const url = new URL(request.url);
    // GET /rules/score-histogram returns the no-engine histogram shape — the engine-less equivalent of
    // the real container endpoint, matching what production returns before the scan engine is wired.
    if (url.pathname === "/rules/score-histogram") {
      return new Response(
        JSON.stringify({ engineVersion: null, minScoreGate: null, total: 0, buckets: [] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.pathname === "/identify") {
      return new Response(
        JSON.stringify({ label: "jpeg", score: 0.99, group: "image",
          magikaVersion: "test", modelVersion: "test" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    // The default (/scan): the no-engine RawScanResult (honest unscanned, never a fake clean), unless the
    // body carries the test malware marker — then an infected clam verdict (a deployed engine), which lets
    // the file-repair re-scan withhold path be exercised end to end. No production test sends the marker,
    // so scan behaviour is otherwise unchanged.
    const scanBody = await request.text();
    if (scanBody.includes("MALWARE_EICAR")) {
      return new Response(
        JSON.stringify({
          engineVersion: "test-engine",
          clam: { state: "infected", signature: "Test.EICAR.Marker" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        engineVersion: null,
        clam: { state: "unavailable" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 0, yaraMs: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};
`;

// Stub for the magna-carta-file-repair service binding in tests — no real recovery worker runs under the
// local pool. Returns a canned diagnosis for /diagnose; for /repair, a RepairResult with one
// reconstructed file; for /carve, a RepairResult with multiple files to exercise the N-file loop.
// Bytes carry the scan malware marker only when the input asked for it (input contains "TRIGGERMALWARE"),
// and a 422 { code } when the input asks to be unrepairable ("UNREPAIRABLE").
// This lets the route tests drive the happy path, the unrepairable path, and the re-scan withhold path.
const FILE_REPAIR_SERVICE_STUB_SCRIPT = `
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const json = (obj, status) =>
      new Response(JSON.stringify(obj), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname === "/diagnose") {
      return json({
        detectedFormat: "pdf",
        corruption: ["brokenCrossReference"],
        recoverability: "repairable",
        repairSupported: true,
        carveSuggested: false,
        detail: "pdf document",
      });
    }
    const body = await request.text();
    if (body.includes("UNREPAIRABLE")) {
      return json({ code: "unrepairable" }, 422);
    }
    const outputText = body.includes("TRIGGERMALWARE")
      ? "MALWARE_EICAR_marker_payload"
      : "clean-reconstructed-bytes";
    // For carve, return multiple files; for repair, return a single file.
    const files = url.pathname === "/carve"
      ? [
          { name: "carved.jpg", mediaType: "image/jpeg", contentBase64: btoa(outputText) },
          { name: "carved.png", mediaType: "image/png", contentBase64: btoa(outputText) },
          { name: "embedded.pdf", mediaType: "application/pdf", contentBase64: btoa(outputText) },
        ]
      : [{ name: "repaired", mediaType: "application/pdf", contentBase64: btoa(outputText) }];
    return json({
      files,
      loss: { items: [{ name: "body", recovered: true, detail: "" }], fullyRecovered: true, synthesized: [] },
    });
  }
};
`;

// Stub for the magna-carta-bundle service binding in tests — no real bundle worker runs under
// the local pool, so the service binding must resolve to something or workerd refuses to boot.
// POST /build (non-streaming) returns a minimal canned BuildResponse (ok, one zero-byte volume
// key) so bundle-coordinator tests can exercise the coordinator's happy path without a live worker.
// POST /build?stream=1 (encrypted-stream lane) returns a small fixed body so the encrypted-stream
// route tests can assert the 200 + content-type without a real container.
const BUNDLE_SERVICE_STUB_SCRIPT = `
export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.searchParams.has("stream")) {
      return new Response("stub-archive-bytes", {
        status: 200,
        headers: { "content-type": "application/zip" },
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        volumes: [{ key: "bundles/stub/bundle.zip", sizeBytes: 0 }],
        error: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};
`;

// Stub for the magna-carta-recovery service binding in tests — no real recovery worker runs under
// the local pool, so the service binding must resolve to something or workerd refuses to boot.
// POST /recover-shard returns an honest zero-count miss (never a fabricated hit) so any test that
// inadvertently reaches the real RECOVERY_SERVICE binding (rather than driving the queue consumer
// directly with a fake RecoveryBackend, the pattern the recovery e2e test uses for a deterministic
// found/miss split) gets a shape-correct ShardOutcome, not a boot failure or a silent hit.
const RECOVERY_SERVICE_STUB_SCRIPT = `
export default {
  fetch() {
    return new Response(
      JSON.stringify({ found: null, candidatesTried: 0 }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};
`;

// Stub for the magna-carta-ocr service binding in tests — no real recognition worker runs under
// the local pool, so the service binding must resolve to something or workerd refuses to boot.
// Returns a shape-correct ResultSchema response (one page, no lines) — an honest empty-page result,
// never fabricated recognized text, so a future route test can assert on the response shape without
// a live Container.
const OCR_SERVICE_STUB_SCRIPT = `
export default {
  fetch(request) {
    if (new URL(request.url).pathname === "/ocr/searchable") {
      return new Response("%PDF-1.7 searchable-stub", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    return new Response(
      JSON.stringify({
        pages: [
          { pageIndex: 0, lines: [], undecodedRegions: 0, skipped: null, orientationDegrees: null },
        ],
        provenance: { engineVersion: "test-engine", modelVersion: "test-model", platform: "test" },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};
`;

// Stub for the magna-carta-sign service binding in tests — no real sign worker (and no platform
// signing key) runs under the local pool, so the SIGN_SERVICE binding must resolve to something or
// workerd refuses to boot. It returns 503 seal-not-configured — the honest deferred-activation posture
// (there is no signing identity in the test pool), which resolveSealPort maps to the 503 path. The
// app-worker seal route test injects a fake SealPort directly to drive the sealed-response path, so
// this stub only needs to satisfy startup and the not-configured branch.
const SIGN_SERVICE_STUB_SCRIPT = `
export default {
  fetch(request) {
    if (new URL(request.url).pathname === "/seal") {
      return new Response(JSON.stringify({ error: "seal-not-configured" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }
};
`;

// Run Vitest inside Miniflare so the integration test gets real Worker bindings (D1/R2/Queues/ASSETS) loaded from wrangler.jsonc.
// @cloudflare/vitest-plugin exposes the harness as the cloudflareTest() Vite plugin; configPath points it at our Wrangler config so the same bindings back the test as back `wrangler dev`.
// root is pinned to this package so the pool resolves `vitest/worker` (and the wrangler config) from apps/api-worker even when this config is loaded as a Vitest project from the repo-root `vp test`; without it the workerd VM reports `No such module "vitest/worker"`.
// miniflare.workers registers an auxiliary stub worker named "magna-carta-scan" so the SCAN_SERVICE
// service binding declared in wrangler.jsonc resolves without a real scan worker running in the pool.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    sqlAsText(),
    billingPackageSources(),
    pdfCoreFixtures(),
    documentAssemblyFormFixtures(),
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
      // Eleven service bindings in wrangler.jsonc reference dedicated workers that do not run under the
      // local pool — magna-carta-scan (SCAN_SERVICE), magna-carta-convert (CONVERT), magna-carta-bundle
      // (BUNDLE_SERVICE), magna-carta-file-repair (FILE_REPAIR_SERVICE), magna-carta-recovery
      // (RECOVERY_SERVICE), magna-carta-ocr (OCR_SERVICE), magna-carta-sign (SIGN_SERVICE),
      // magna-carta-discovery (DISCOVERY_SERVICE), and the three version-read-only bindings
      // (EDIT_SERVICE, STATUS_SERVICE, WEB_SERVICE).
      // Miniflare requires all to exist, so register minimal stubs. The scan stub returns the no-engine
      // RawScanResult (an honest unscanned, never a fake clean, plus a malware-marker branch for the
      // file-repair re-scan test); the convert stub only satisfies startup validation (conversion tests
      // inject fakes directly); the file-repair stub returns canned diagnose/repair/carve JSON so the
      // file-repair route tests drive the real path; the bundle stub returns a canned BuildResponse for
      // the coordinator's happy path; the recovery stub returns an honest zero-count miss so the pool
      // boots (the recovery e2e test drives the queue consumer directly with a fake RecoveryBackend
      // rather than routing through this stub); the ocr stub returns a shape-correct empty-page result;
      // the sign stub returns 503 seal-not-configured (no signing identity in the pool) so the seal
      // route's not-configured path is exercised, while the sealed-response path is driven by a fake
      // SealPort injected in the route test.
      miniflare: {
        workers: [
          {
            name: "magna-carta-scan",
            modules: true,
            script: SCAN_SERVICE_STUB_SCRIPT,
          },
          {
            name: "magna-carta-convert",
            modules: true,
            script: `export default { fetch() { return new Response("stub", { status: 501 }); } };`,
          },
          {
            name: "magna-carta-bundle",
            modules: true,
            script: BUNDLE_SERVICE_STUB_SCRIPT,
          },
          {
            name: "magna-carta-file-repair",
            modules: true,
            script: FILE_REPAIR_SERVICE_STUB_SCRIPT,
          },
          {
            name: "magna-carta-recovery",
            modules: true,
            script: RECOVERY_SERVICE_STUB_SCRIPT,
          },
          {
            name: "magna-carta-ocr",
            modules: true,
            script: OCR_SERVICE_STUB_SCRIPT,
          },
          {
            name: "magna-carta-sign",
            modules: true,
            script: SIGN_SERVICE_STUB_SCRIPT,
          },
          {
            name: "magna-carta-discovery",
            modules: true,
            script: `export default { fetch() { return new Response("stub", { status: 503 }); } };`,
          },
          // The three version-read-only bindings (EDIT_SERVICE / STATUS_SERVICE / WEB_SERVICE)
          // resolve to workers that do not run under the pool either; a 404 stub is the honest
          // shape (a worker answering without the version route — the aggregate reads it as
          // "unreported"), and nothing else in the test suite calls through these bindings.
          {
            name: "magna-carta-edit",
            modules: true,
            script: `export default { fetch() { return new Response("stub", { status: 404 }); } };`,
          },
          {
            name: "magna-carta-status",
            modules: true,
            script: `export default { fetch() { return new Response("stub", { status: 404 }); } };`,
          },
          {
            name: "magna-carta-web",
            modules: true,
            script: `export default { fetch() { return new Response("stub", { status: 404 }); } };`,
          },
        ],
        // The meeting-recording queue is not bound in wrangler.jsonc until the account has it, because a
        // deploy that binds a missing queue fails. The pool binds it as a producer of its own so the
        // recording routes run as they will once it exists; the consumer is driven directly by the
        // tests that need it.
        queueProducers: {
          MEETING_RECORDING_COMPOSE: { queueName: "magna-carta-test-meeting-recording-compose" },
        },
      },
    }),
  ],
  test: {
    // Files that declare `@node-runtime` run in plain Node instead (vitest.node.config.ts): booting
    // a workerd VM and preloading the whole app for a file that never reaches the Workers runtime
    // cost about 25 s of setup per file, and that preload is most of this project's memory.
    exclude: ["**/node_modules/**", "**/.git/**", ...nodeRuntimeTestFiles()],
    // Every file gets the background-work barrier: routes start work that outlives their response
    // (the request-path outbox sweep), and an environment torn down while that work is still talking
    // to the test host rejects its in-flight calls into nothing. The setup file's afterEach waits for
    // the worker to go quiet — see test/support/settle-background-work.ts for the full mechanism.
    setupFiles: ["./test/support/settle-background-work.ts"],
    // Every file's beforeAll applies the control-plane migrations before its first test, and the
    // heavier suites then seed several firms through the real registration flow (document-automation
    // seeds six). On a 2-core CI runner with four workerd VMs sharing the box that is well past the
    // 10-second default: the hook timed out twice on the gate on 2026-09-02 while every test in the
    // file would have passed. Sized to the work rather than the default, and to the hook only — the
    // per-test timeout stays where it is, so a test that hangs still fails fast.
    hookTimeout: 60_000,
    // 16 CPUs but a RAM-constrained dev box (~3 GB free under normal load): each test file boots a
    // Miniflare/workerd VM holding the full app + bindings + the three stub service workers, so the
    // default CPU-wide file parallelism OOMs the box (exit 137). Cap the concurrent VMs to fit
    // memory — peak ≈ maxWorkers × per-VM, independent of file count. CI (more RAM) raises it via the
    // env. Mirrors the fileParallelism guard packages/conversion uses for its wasm heaps.
    maxWorkers: Number(process.env.MC_WORKER_TEST_MAX_WORKERS ?? 4),
    minWorkers: 1,
    // Vitest requires every project sharing a group to agree on maxWorkers, and the capped VM budget
    // above is ours alone — sharing the default group with the ~47 pure packages makes a repo-root
    // `vp test` abort ("different 'maxWorkers' but same 'sequence.groupOrder'") and run NOTHING while
    // still exiting 0. A later group runs this project on its own, so the cap holds and the whole
    // suite is runnable from the root.
    sequence: { groupOrder: 1 },
  },
});
