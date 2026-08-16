import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { NaturalLanguageInstanceState } from "./natural-language-instance.ts";

// SQL statement builders for the CONTROL-PLANE instance record — the platform's own catalog of which
// firms have a managed natural-language search instance. Table name tracked against
// @magna-carta/database's control-plane schema by the schema-name-sync fitness test beside this file.
//
// THE ROW IS THE CATALOG, and there is deliberately no read here that asks the service what exists.
// Asking it would make the service the authority on a fact the platform owns, and would make an
// outage indistinguishable from a firm having no instance — the same reason the keyword index keeps
// a split catalog rather than listing a bucket prefix.
//
// This is the one module in this package that takes a CONTROL-PLANE handle rather than a firm-scoped
// one, because the instance is a resource in the platform's account rather than a fact about a
// firm's matters. Every statement is keyed by firm id, so a read for one firm cannot return another's.

export const AI_SEARCH_INSTANCE_TABLE = "ai_search_instance";

export interface InstanceRow {
  readonly firmId: FirmId;
  readonly instanceName: string;
  readonly instanceIdentifier: string | null;
  readonly configurationGeneration: number;
  readonly state: NaturalLanguageInstanceState;
  readonly teardownResponse: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface InstanceDatabaseRow {
  firm_id: string;
  instance_name: string;
  instance_identifier: string | null;
  configuration_generation: number;
  state: string;
  teardown_response: string | null;
  created_at: string;
  updated_at: string;
}

function toInstanceRow(row: InstanceDatabaseRow): InstanceRow {
  return {
    firmId: row.firm_id as FirmId,
    instanceName: row.instance_name,
    instanceIdentifier: row.instance_identifier,
    configurationGeneration: row.configuration_generation,
    state: row.state as NaturalLanguageInstanceState,
    teardownResponse: row.teardown_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Claim the provisioning attempt. An upsert keyed on the firm, so a repeated opt-in converges on one
// row — and the instance name is DERIVED from the firm identifier, so the repeated attempt converges
// on the same instance too. Between them, a provisioning step that died halfway is restartable
// rather than leaky: nothing mints a second name and nothing orphans the first.
export function claimInstanceProvisioningStatement(
  database: SqlDatabase,
  input: {
    readonly firmId: FirmId;
    readonly instanceName: string;
    readonly configurationGeneration: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${AI_SEARCH_INSTANCE_TABLE} (firm_id, instance_name, instance_identifier, configuration_generation, state, teardown_response, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, 'provisioning', NULL, ?4, ?4) ON CONFLICT (firm_id) DO UPDATE SET instance_name = excluded.instance_name, configuration_generation = excluded.configuration_generation, state = 'provisioning', teardown_response = NULL, updated_at = excluded.updated_at`,
    )
    .bind(input.firmId, input.instanceName, input.configurationGeneration, input.now);
}

// The create succeeded: record the identifier the service returned, verbatim, and move to ready.
export function markInstanceReadyStatement(
  database: SqlDatabase,
  input: { readonly firmId: FirmId; readonly instanceIdentifier: string; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${AI_SEARCH_INSTANCE_TABLE} SET instance_identifier = ?2, state = 'ready', updated_at = ?3 WHERE firm_id = ?1`,
    )
    .bind(input.firmId, input.instanceIdentifier, input.now);
}

// Teardown has begun. Recorded before the feed is deleted and before the service is called, so a
// teardown that dies partway is visible as a teardown in progress rather than as a ready instance
// whose feed is half gone.
export function markInstanceTearingDownStatement(
  database: SqlDatabase,
  firmId: FirmId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${AI_SEARCH_INSTANCE_TABLE} SET state = 'tearing-down', updated_at = ?2 WHERE firm_id = ?1`,
    )
    .bind(firmId, now);
}

// Teardown finished. `absent` is a RECORDED state, not a deleted row: a firm that opted out and was
// torn down is a different fact from a firm that never opted in, and only the recorded state — with
// the service's own response beside it — can answer a question about it afterwards.
//
// The response is stored as the service gave it and NOTHING is concluded from it. The platform can
// demonstrate deletion of the text it wrote into storage it owns; deletion of the managed index is a
// request whose completeness it cannot demonstrate, so this column is a record and not a proof.
export function markInstanceAbsentStatement(
  database: SqlDatabase,
  input: { readonly firmId: FirmId; readonly teardownResponse: string; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${AI_SEARCH_INSTANCE_TABLE} SET state = 'absent', instance_identifier = NULL, teardown_response = ?2, updated_at = ?3 WHERE firm_id = ?1`,
    )
    .bind(input.firmId, input.teardownResponse, input.now);
}

export async function readInstanceForFirm(
  database: SqlDatabase,
  firmId: FirmId,
): Promise<InstanceRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT firm_id, instance_name, instance_identifier, configuration_generation, state, teardown_response, created_at, updated_at FROM ${AI_SEARCH_INSTANCE_TABLE} WHERE firm_id = ?1 LIMIT 1`,
    )
    .bind(firmId)
    .all<InstanceDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : toInstanceRow(row);
}

// Every ready instance, for the weekly keep-alive sweep. Bounded and ordered by firm so the sweep
// pages deterministically; an instance in any other state is not kept alive, because there is
// nothing to keep alive and a query against it would be an error rather than a heartbeat.
export async function readReadyInstances(
  database: SqlDatabase,
  limit: number,
  afterFirmId?: FirmId,
): Promise<readonly InstanceRow[]> {
  const selection = `SELECT firm_id, instance_name, instance_identifier, configuration_generation, state, teardown_response, created_at, updated_at FROM ${AI_SEARCH_INSTANCE_TABLE} WHERE state = 'ready'`;
  const statement =
    afterFirmId === undefined
      ? database.prepare(`${selection} ORDER BY firm_id LIMIT ?1`).bind(limit)
      : database
          .prepare(`${selection} AND firm_id > ?1 ORDER BY firm_id LIMIT ?2`)
          .bind(afterFirmId, limit);
  const { results } = await statement.all<InstanceDatabaseRow>();
  return results.map(toInstanceRow);
}
