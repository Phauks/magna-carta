import type { Bindings } from "./app.ts";

// The dev firm-database pool, in claim order (slice 0·4, decided #12): wrangler.jsonc pre-declares
// a fixed pool of firm databases because Miniflare cannot create D1 at runtime, and a claimed
// firm's database_identifier IS the pool binding name. The dev FirmResourceProvider claims from
// this list. Adding a pool member touches three places in lockstep: wrangler.jsonc, the Bindings
// type in app.ts, and this module (the list + the table below).
export const DEV_FIRM_DATABASE_POOL_BINDING_NAMES = ["DB_FIRM_POOL_1", "DB_FIRM_POOL_2"] as const;

// firm.database_identifier → the firm's D1 database. This is the same seam deploy-time per-firm
// bindings resolve through later (the Cloudflare REST adapter records real database UUIDs;
// deploys bind them under the same lookup).
//
// Unknown identifier → null: a firm whose database this deployment cannot reach is treated as
// absent — the caller maps null to the ADR-0052 404, never a 500 and never an existence oracle.
export function resolveFirmDatabase(env: Bindings, databaseIdentifier: string): D1Database | null {
  const pool: Readonly<Record<string, D1Database>> = {
    DB_FIRM_POOL_1: env.DB_FIRM_POOL_1,
    DB_FIRM_POOL_2: env.DB_FIRM_POOL_2,
  };
  return pool[databaseIdentifier] ?? null;
}
