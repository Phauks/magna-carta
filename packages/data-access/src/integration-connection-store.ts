import type { CapabilityDescriptor } from "@magna-carta/integrations/port";
import type {
  ConnectionLookup,
  ConnectionStore,
  IntegrationConnection,
} from "@magna-carta/integrations/connection";
import type { SqlDatabase } from "./idempotency-statements.ts";
import { selectConnectionStatement } from "./integration-connection-statements.ts";

interface ConnectionRow {
  id: string;
  category: string;
  adapter_id: string;
  scope: "firm" | "user";
  principal_ref: string;
  credential_ref: string;
  status: IntegrationConnection["status"];
  capability_snapshot: string;
}

// Firm-scoped: the database handed in IS the firm's D1, so isolation is structural — a lookup can
// only ever read this firm's connections. The principal is the user for user-scoped ports, else the
// firm (principalRef = userId ?? firmId).
export function createConnectionStore(database: SqlDatabase): ConnectionStore {
  return {
    async getConnection(lookup: ConnectionLookup): Promise<IntegrationConnection | null> {
      const principalRef = lookup.userId ?? lookup.firmId;
      const { results } = await selectConnectionStatement(
        database,
        lookup.category,
        principalRef,
      ).all<ConnectionRow>();
      const row = results[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        category: row.category,
        adapterId: row.adapter_id,
        scope: row.scope,
        principalRef: row.principal_ref,
        credentialRef: row.credential_ref,
        status: row.status,
        capabilitySnapshot: JSON.parse(row.capability_snapshot) as CapabilityDescriptor,
      };
    },
  };
}
