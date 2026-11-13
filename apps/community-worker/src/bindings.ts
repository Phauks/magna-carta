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
  // is readable and sign-in answers that it is not set up.
  readonly COMMUNITY_HANDOFF_SECRET?: string;
}
