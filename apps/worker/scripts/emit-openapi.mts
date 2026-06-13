// Emits the committed OpenAPI 3.1 snapshot (openapi/openapi.json) — the single contract artifact
// that CI re-derives and diff-gates (code-as-contract), Spectral lints, oasdiff compares, Hey API
// feeds, and Prism mocks. NEVER hand-edit the snapshot; run `pnpm --filter @magna-carta/worker run
// emit-openapi` (or let CI catch the drift).
//
// The worker's route graph is bundler-targeted (extensionless imports, `.sql` text modules, `.json`
// without import attributes) and never loads under plain Node ESM, so the document is built through
// a programmatic Vite SSR pipeline — the same transforms tests and `wrangler` build use — guaranteeing
// the emitted document matches what the running Worker serves.
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

const workerRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = fileURLToPath(new URL("../openapi/openapi.json", import.meta.url));

const server = await createServer({
  configFile: false,
  root: workerRoot,
  logLevel: "warn",
  server: { middlewareMode: true, watch: null },
  plugins: [sqlAsText()],
});

try {
  const ssr = server.environments.ssr;
  if (!isRunnableDevEnvironment(ssr)) {
    throw new Error(
      "Vite SSR environment is not runnable — cannot load the worker app for emission.",
    );
  }
  const app = (await ssr.runner.import("./src/app.ts")) as typeof import("../src/app.ts");
  mkdirSync(fileURLToPath(new URL("../openapi/", import.meta.url)), { recursive: true });
  writeFileSync(outputPath, app.serializeOpenAPIDocument());
  console.log(`Wrote OpenAPI snapshot: ${outputPath}`);
} finally {
  await server.close();
}
