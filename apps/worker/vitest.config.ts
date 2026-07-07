import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig, type Plugin } from "vite-plus";

// The Vite-side half of the dual `.sql`-as-text bundling contract — full story in
// src/sql-modules.d.ts (the wrangler-side half is the Text module rule in wrangler.jsonc).
function sqlAsText(): Plugin {
  return {
    name: "magna-carta:sql-as-text",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".sql")) return null;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

// The fitness scan tests (billing-wip-ledger-fitness, billing-freeze-fitness) need to scan the
// package sources where the SQL statement strings actually live — packages/timekeeping/src,
// packages/costs/src, and packages/billing-core/src — but import.meta.glob cannot resolve outside
// the Vite root (apps/worker). This plugin provides a virtual module that inlines those sources at
// build time, each file keyed under its own package prefix, so the scans cover all three packages
// and each can be floored for non-vacuity independently.
function billingPackageSources(): Plugin {
  const virtualModuleId = "virtual:billing-package-sources";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const timekeepingSrcDir = path.resolve(import.meta.dirname, "../../packages/timekeeping/src");
  const costsSrcDir = path.resolve(import.meta.dirname, "../../packages/costs/src");
  const billingCoreSrcDir = path.resolve(import.meta.dirname, "../../packages/billing-core/src");

  function collectSources(dir: string, prefix: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        Object.assign(result, collectSources(fullPath, key));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        result[key] = fs.readFileSync(fullPath, "utf8");
      }
    }
    return result;
  }

  return {
    name: "magna-carta:billing-package-sources",
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
      return undefined;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return undefined;
      const sources: Record<string, string> = {};
      Object.assign(sources, collectSources(timekeepingSrcDir, "packages/timekeeping/src"));
      Object.assign(sources, collectSources(costsSrcDir, "packages/costs/src"));
      Object.assign(sources, collectSources(billingCoreSrcDir, "packages/billing-core/src"));
      return `export default ${JSON.stringify(sources)};`;
    },
  };
}

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

// Run Vitest inside Miniflare so the integration test gets real Worker bindings (D1/R2/Queues/ASSETS) loaded from wrangler.jsonc.
// @cloudflare/vitest-pool-workers 0.16.x exposes the harness as the cloudflareTest() Vite plugin (the older defineWorkersConfig/poolOptions shape was removed); configPath points it at our Wrangler config so the same bindings back the test as back `wrangler dev`.
// root is pinned to this package so the pool resolves `vitest/worker` (and the wrangler config) from apps/worker even when this config is loaded as a Vitest project from the repo-root `vp test`; without it the workerd VM reports `No such module "vitest/worker"`.
// miniflare.workers registers an auxiliary stub worker named "magna-carta-scan" so the SCAN_SERVICE
// service binding declared in wrangler.jsonc resolves without a real scan worker running in the pool.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    sqlAsText(),
    billingPackageSources(),
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
      // Five service bindings in wrangler.jsonc reference dedicated workers that do not run under the
      // local pool — magna-carta-scan (SCAN_SERVICE), magna-carta-convert (CONVERT), magna-carta-bundle
      // (BUNDLE_SERVICE), magna-carta-file-repair (FILE_REPAIR_SERVICE), and magna-carta-recovery
      // (RECOVERY_SERVICE). Miniflare requires all to exist, so register minimal stubs. The scan stub
      // returns the no-engine RawScanResult (an honest unscanned, never a fake clean, plus a
      // malware-marker branch for the file-repair re-scan test); the convert stub only satisfies startup
      // validation (conversion tests inject fakes directly); the file-repair stub returns canned
      // diagnose/repair/carve JSON so the file-repair route tests drive the real path; the bundle stub
      // returns a canned BuildResponse for the coordinator's happy path; the recovery stub returns an
      // honest zero-count miss so the pool boots (the recovery e2e test drives the queue consumer
      // directly with a fake RecoveryBackend rather than routing through this stub).
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
        ],
      },
    }),
  ],
  test: {
    // 16 CPUs but a RAM-constrained dev box (~3 GB free under normal load): each test file boots a
    // Miniflare/workerd VM holding the full app + bindings + the three stub service workers, so the
    // default CPU-wide file parallelism OOMs the box (exit 137). Cap the concurrent VMs to fit
    // memory — peak ≈ maxWorkers × per-VM, independent of file count. CI (more RAM) raises it via the
    // env. Mirrors the fileParallelism guard packages/conversion uses for its wasm heaps.
    maxWorkers: Number(process.env.MC_WORKER_TEST_MAX_WORKERS ?? 4),
    minWorkers: 1,
  },
});
