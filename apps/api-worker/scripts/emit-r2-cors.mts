// Prints the browser-upload CORS rule set as the JSON the R2 dashboard's "Add CORS policy" accepts,
// for the buckets provisioning does not reach (the shared platform bucket, and firm buckets that
// predate the provisioning step). `pnpm --filter @magna-carta/api-worker run emit-r2-cors`.
//
// Plain Node, no bundler: the module it imports has no imports of its own, so Node's type stripping
// loads it directly — unlike emit-openapi, which has to go through Vite for the worker's route graph.
import { BROWSER_UPLOAD_CORS_RULES } from "../src/files/browser-upload-cors.ts";

process.stdout.write(`${JSON.stringify(BROWSER_UPLOAD_CORS_RULES, null, 2)}\n`);
