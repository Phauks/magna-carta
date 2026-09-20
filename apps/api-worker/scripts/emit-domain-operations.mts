// Emits each domain module's committed operation list (src/routes/<domain>/operations.ts): the
// operation ids the module registers when mounted alone, sorted. The conformance suite holds every
// module to its list, and the whole-document assertion is the sum of them — so a route added from any
// branch is a diff in its own domain's file, never an edit to one 600-line list.
//
// Loaded through the same programmatic Vite SSR pipeline as emit-openapi.mts, for the same reason: the
// route graph never loads under plain Node ESM. Run: `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment, type Plugin } from "vite-plus";

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
const server = await createServer({
  configFile: false,
  root: workerRoot,
  logLevel: "warn",
  server: { middlewareMode: true, watch: null },
  plugins: [sqlAsText(), wasmAsStub(), stubCloudflareWorkers()],
});

const METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"] as const;

try {
  const ssr = server.environments.ssr;
  if (!isRunnableDevEnvironment(ssr)) {
    throw new Error("Vite SSR environment is not runnable — cannot load the worker app.");
  }
  const app = (await ssr.runner.import("./src/app.ts")) as typeof import("../src/app.ts");
  let total = 0;
  for (const [domain, document] of app.buildDomainOpenAPIDocuments()) {
    const ids: string[] = [];
    for (const pathItem of Object.values(document.paths ?? {})) {
      for (const method of METHODS) {
        const operation = pathItem[method];
        if (operation?.operationId) ids.push(operation.operationId);
      }
    }
    ids.sort();
    total += ids.length;
    const body = `// The operations the ${domain} module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with \`pnpm --filter @magna-carta/api-worker run
// emit-domain-operations\`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
${ids.map((id) => `  ${JSON.stringify(id)},`).join("\n")}
];
`;
    writeFileSync(
      fileURLToPath(new URL(`../src/routes/${domain}/operations.ts`, import.meta.url)),
      body,
    );
    console.log(`${domain}: ${ids.length} operation(s)`);
  }
  console.log(`total: ${total}`);
} finally {
  await server.close();
}
