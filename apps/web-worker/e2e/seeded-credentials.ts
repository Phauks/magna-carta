import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The channel between the seed setup and the specs. The setup POSTs to the Worker's dev-only seed
// route and writes the returned tenant here; every spec reads it back. A file (not an env var or
// module global) is the channel because Playwright runs the setup and the specs in separate worker
// processes — a plain module value would not cross that boundary. Kept out of version control (see
// the repo .gitignore entry for apps/web-worker/e2e/.seeded/): it is a per-run artifact of a local dev
// tenant, and the credentials it carries are the well-known local-dev literals from the seed route.

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));

export const seededCredentialsPath = path.join(harnessDirectory, ".seeded", "credentials.json");

export interface SeededTenant {
  readonly firmId: string;
  readonly matterId: string;
  readonly credentials: { readonly email: string; readonly password: string };
  readonly signInEndpoint: string;
}

/** Reads the tenant the seed setup wrote. Throws a directing error if the setup did not run. */
export function readSeededTenant(): SeededTenant {
  let raw: string;
  try {
    raw = readFileSync(seededCredentialsPath, "utf8");
  } catch {
    throw new Error(
      `Seeded credentials not found at ${seededCredentialsPath}. The "setup" project must run ` +
        "first (it POSTs to /api/__dev/seed); run the suite via `pnpm --filter @magna-carta/web-worker " +
        "run test:e2e`, which wires the setup dependency.",
    );
  }
  return JSON.parse(raw) as SeededTenant;
}
