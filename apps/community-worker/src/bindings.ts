import type { SqlDatabase } from "@magna-carta/community/sql-database";

/**
 * What the board's worker is bound to: the control-plane database, the status page's store (read
 * only, for Known Issues), the app's address and one secret.
 */
export interface Bindings {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly DB_CONTROL: D1Database & SqlDatabase;
  readonly STATUS_KV: KVNamespace;
  readonly APP_BASE_URL: string;
  // Shared with magna-carta's own worker, which mints the one-minute sign-in link. Absent, the board
  // is readable and sign-in answers that it is not set up. A per-Worker secret, or a Secrets Store
  // binding (SECRETS_STORE_COMMUNITY_HANDOFF_SECRET) that the entry resolves into this string.
  readonly COMMUNITY_HANDOFF_SECRET?: string;
}

/** The secrets this worker reads, each of which may be bound from the account's Secrets Store. */
export const COMMUNITY_WORKER_SECRET_NAMES = ["COMMUNITY_HANDOFF_SECRET"] as const;
