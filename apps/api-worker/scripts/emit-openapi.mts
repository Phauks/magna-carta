// Emits the committed OpenAPI 3.1 snapshot (openapi/openapi.json) — the single contract artifact
// that CI re-derives and diff-gates (code-as-contract), Spectral lints, oasdiff compares, Hey API
// feeds, and Prism mocks. NEVER hand-edit the snapshot; run `pnpm --filter @magna-carta/api-worker run
// emit-openapi` (or let CI catch the drift).
//
// The worker's route graph is bundler-targeted (extensionless imports, `.sql` text modules, `.json`
// without import attributes) and never loads under plain Node ESM, so the document is built through
// a programmatic Vite SSR pipeline — the same transforms tests and `wrangler` build use — guaranteeing
// the emitted document matches what the running Worker serves.
//
// Outside the worker's typecheck boundary by design: the worker tsconfig pins `types:
// [@cloudflare/workers-types]` so that `node:fs` is correctly a type error in `src/`, and the repo
// type-checks one tsconfig per package — there is no node-typed program for this node-side script to
// join without that hygiene loss. The gap is covered: CI runs `emit-openapi` every build (a broken
// script crashes the job before the diff gate), and the typechecked snapshot test imports
// `serializeOpenAPIDocument` from app.ts, so a renamed/removed export fails the type gate at once.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment, type Plugin } from "vite-plus";

// The Vite-side half of the dual `.sql`-as-text bundling contract (the one home for the contract is
// src/sql-modules.d.ts; vitest.config.ts carries the test-side copy). Inlined here so the emitter
// stays a self-contained tool that needs no shared config wiring.
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

// Stubs `.wasm` imports so the Vite SSR runner can load the worker app without the WebAssembly ESM
// integration proposal (not supported in the SSR pipeline). The `load` hook (enforce: "pre") runs
// before Vite's builtin:vite-wasm-fallback, intercepting the WASM before it errors. The route
// handlers that call ensureReady() are never invoked during emission — only the OpenAPI route schema
// is traversed — so a null stub is safe here. Wrangler handles real WASM at deploy time.
function wasmAsStub(): Plugin {
  return {
    name: "magna-carta:wasm-as-stub",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(".wasm")) return null;
      return `export default null;`;
    },
  };
}

// `cloudflare:workers` is a workerd-provided virtual module (the Durable Object base classes the DO
// modules extend). The route graph reaches a DO module for its request-time stub helper, but emission
// needs only the static route metadata, never the DO runtime — so resolve the virtual to an inert stub
// rather than fail to load it (plain Vite SSR, unlike the test/wrangler builds, has no workerd shim).
function stubCloudflareWorkers(): Plugin {
  const virtualId = "\0magna-carta:cloudflare-workers-stub";
  return {
    name: "magna-carta:stub-cloudflare-workers",
    enforce: "pre",
    resolveId(id) {
      return id === "cloudflare:workers" ? virtualId : null;
    },
    load(id) {
      return id === virtualId
        ? "export class DurableObject {}\nexport class WorkerEntrypoint {}\n"
        : null;
    },
  };
}

const workerRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = fileURLToPath(new URL("../openapi/openapi.json", import.meta.url));

const server = await createServer({
  configFile: false,
  root: workerRoot,
  logLevel: "warn",
  server: { middlewareMode: true, watch: null },
  plugins: [sqlAsText(), wasmAsStub(), stubCloudflareWorkers()],
});

try {
  const ssr = server.environments.ssr;
  if (!isRunnableDevEnvironment(ssr)) {
    throw new Error(
      "Vite SSR environment is not runnable — cannot load the worker app for emission.",
    );
  }
  const app = (await ssr.runner.import("./src/app.ts")) as typeof import("../src/http/app.ts");
  mkdirSync(fileURLToPath(new URL("../openapi/", import.meta.url)), { recursive: true });
  writeFileSync(outputPath, app.serializeOpenAPIDocument());
  console.log(`Wrote OpenAPI snapshot: ${outputPath}`);
} finally {
  await server.close();
}
