import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as controlPlaneSchema from "../src/control-plane-schema.ts";
import * as perFirmSchema from "../src/per-firm-schema.ts";
import { BETTER_AUTH_TABLE_NAMES } from "./better-auth-table-names.ts";

// Every drizzle table exported by either lineage. New tables are enumerated automatically —
// these fitness functions bind to the whole schema surface, not a hand-kept list.
const ALL_TABLES = (
  [...Object.values(controlPlaneSchema), ...Object.values(perFirmSchema)] as unknown[]
).filter((candidate): candidate is SQLiteTable => candidate instanceof SQLiteTable);

describe("schema conformance (fitness functions)", () => {
  it("found the expected tables (guards the enumeration itself)", () => {
    // control-plane: firm + the five Better Auth tables + auth_audit + outbox + idempotency_key (9);
    // per-firm: idempotency_key, outbox, ledger_account, ledger_entry, ledger_line, account_balance,
    // member, role, role_permission, member_role, direct_grant, incident (12) + location,
    // location_address, member_location, matter_type, document_type, numbering_scheme,
    // matter_number_counter, matter, folder, file, file_version, upload_session, storage_meter,
    // token_usage_meter, setting, audit_log (16) = 28 per-firm + directory_person, directory_organization,
    // directory_name, directory_name_phonetic_code, directory_identifier, directory_edge,
    // directory_category, directory_entity_category, directory_email, directory_phone,
    // directory_address, directory_party_role, matter_party, entity_merge (14 directory) = 42 per-firm;
    // 9 + 42 = 51 across both lineages.
    expect(ALL_TABLES.length).toBeGreaterThanOrEqual(51);
  });

  it("auth tables exist ONLY in the control-plane lineage — never in the per-firm schema", () => {
    // Tenancy boundary: credentials and sessions live in the control plane; each firm's
    // D1 carries only the member MIRROR (keyed by the global user handle), never auth state.
    const perFirmTableNames = new Set(
      (Object.values(perFirmSchema) as unknown[])
        .filter((candidate): candidate is SQLiteTable => candidate instanceof SQLiteTable)
        .map((table) => getTableConfig(table).name),
    );
    for (const authTableName of BETTER_AUTH_TABLE_NAMES) {
      expect(perFirmTableNames.has(authTableName), authTableName).toBe(false);
    }
  });

  it("every table's primary key is a TEXT identifier handle named id (natural/composite keys are documented exceptions)", () => {
    // Sanctioned single-column exceptions — the PK is still TEXT, just not a fresh handle:
    //  - account_balance: the materialized balance row of its ledger_account (owner's handle).
    //  - member: the per-firm mirror of the control-plane user — keyed by the GLOBAL user handle.
    //  - matter_number_counter: a counter keyed by its scope (like the migration tracker, _migrations).
    //  - custody_number_counter: the same counter shape for custody numbers, keyed by its scope.
    //  - setting: key/value config keyed by the setting key.
    //  - platform_operator: one row per elevated user — keyed by the GLOBAL user handle, same idiom as member.
    //  - email_capture_route: the control-plane token->firm routing index — the opaque routing token IS
    //    the row's identity (the Email Worker looks a route up by the local part it parsed), same idiom
    //    as setting keyed by its key.
    //  - invoice_number_counter: the invoice-number sequence, keyed by its scope — the same counter
    //    shape as matter_number_counter and custody_number_counter.
    //  - firm_account_role: which ledger account plays each posting role. The ROLE is the identity —
    //    the row exists to answer "which account is accounts receivable", and a handle would add a
    //    lookup to every posting to find the row by the only thing anyone ever asks it by. The role
    //    set is a closed CHECK, so the key cannot grow a typo.
    const naturalSinglePrimaryKeyNames: Record<string, string> = {
      account_balance: "account_id",
      member: "user_id",
      matter_number_counter: "scope_key",
      custody_number_counter: "scope_key",
      invoice_number_counter: "scope_key",
      setting: "key",
      platform_operator: "user_id",
      email_capture_route: "token",
      firm_account_role: "role",
      // A class's structured attributes are one-to-one WITH the asset and have no identity of their
      // own: the asset id IS the row's identity, exactly as account_balance IS its account. A separate
      // handle would add a unique lookup on every read that already arrives holding the asset.
      matter_asset_real_property: "asset_id",
      matter_asset_financial_account: "asset_id",
      matter_asset_vehicle: "asset_id",
      matter_asset_firearm: "asset_id",
      matter_asset_business_interest: "asset_id",
      matter_asset_insurance_policy: "asset_id",
      matter_asset_receivable: "asset_id",
      matter_asset_digital_asset: "asset_id",
      // One acknowledgement per member, and the member IS the row: a second handle would let two
      // acceptances exist for one person, which is precisely the state the version comparison must
      // never have to disambiguate.
      magnus_member_acknowledgement: "user_id",
      // One professional profile per member, and the member IS the row — a second handle would let
      // two profiles exist for one person, and every read already arrives holding the user id.
      member_professional_profile: "member_user_id",
    };
    // storage_meter is keyed by WHAT it rolls up — a composite natural key, no handle. Still all TEXT.
    // token_usage_meter is the same shape — keyed by (day, slot, model_id), all TEXT, append-by-delta.
    // directory_name_phonetic_code is keyed by (name_id, scheme) — a phonetic code row IS its
    // (name, scheme) pair; a separate handle would add nothing and would cost a unique lookup at every
    // phonetic-search join.
    // directory_entity_category is the many-to-many join between a directory entity and a category —
    // the pair (entity_id, category_id) is the natural key; no handle is warranted.
    // scan_cache is keyed by the content hash + engine version whose verdict it caches.
    // scoped_setting is keyed by (key, scope_tier, scoped_id) — the triple IS the identity of a
    // setting row (which key, at which scope tier, for which scoped entity); a separate handle
    // would add nothing and every read would need an extra join to find a row by its natural triple.
    // matter_number_allocation is keyed by (scope_key, drawn_value) — the counter value a matter
    // number draw consumed, in the scope it came from. That pair IS the reservation; a handle would
    // add nothing and would need a unique lookup on every draw to find the row by its natural pair.
    // invoice_number_allocation is the same reservation shape for invoice numbers.
    // invoice_matter_balance is keyed by (invoice_id, matter_id) — the derived balance IS that pair,
    // exactly as account_balance IS its account; every read and every delta arrives holding both.
    // document_template_field_binding is keyed by (template_version_id, merge_key) — a binding IS that
    // pair, there is nothing else to record about one, and both directions of the question ("what does
    // this version bind", "who binds this field") arrive holding one of the two columns.
    const compositeKeyTables = new Set([
      "storage_meter",
      "token_usage_meter",
      "directory_name_phonetic_code",
      "directory_entity_category",
      "matter_number_allocation",
      "custody_number_allocation",
      "invoice_number_allocation",
      "invoice_matter_balance",
      "document_template_field_binding",
      "scan_cache",
      "scoped_setting",
    ]);
    // Composite key columns are TEXT with two documented exceptions, both the same shape: the value a
    // number draw reserves is a counter value, and constraining the NUMBER is the entire point of the
    // row — a string spelling of it would let '01' and '1' both be drawn.
    const integerCompositeKeyColumns = new Set([
      "matter_number_allocation.drawn_value",
      "custody_number_allocation.drawn_value",
      "invoice_number_allocation.drawn_value",
    ]);

    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      if (compositeKeyTables.has(config.name)) {
        const composite = config.primaryKeys[0];
        expect(composite, config.name).toBeDefined();
        expect(composite?.columns.length, config.name).toBeGreaterThan(1);
        for (const column of composite?.columns ?? []) {
          const qualified = `${config.name}.${column.name}`;
          expect(column.getSQLType(), qualified).toBe(
            integerCompositeKeyColumns.has(qualified) ? "integer" : "text",
          );
        }
        continue;
      }
      const primaryColumns = config.columns.filter((column) => column.primary);
      expect(primaryColumns, config.name).toHaveLength(1);
      expect(primaryColumns[0]?.name, config.name).toBe(
        naturalSinglePrimaryKeyNames[config.name] ?? "id",
      );
      expect(primaryColumns[0]?.getSQLType(), config.name).toBe("text");
    }
  });

  it("no money column is a float: *_minor and *_rate_e4 must be INTEGER", () => {
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (column.name.endsWith("_minor") || column.name.endsWith("_rate_e4")) {
          expect(column.getSQLType(), `${config.name}.${column.name}`).toBe("integer");
        }
      }
    }
  });

  it("no column anywhere is REAL — float money can never sneak in under another name", () => {
    // If a legitimately-float column ever appears (it has not yet), add an explicit allowlist HERE
    // with a comment justifying it — the default posture is no floats in a legal/financial schema.
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        expect(column.getSQLType(), `${config.name}.${column.name}`).not.toBe("real");
      }
    }
  });

  it("timestamp columns are ISO-8601 TEXT in our tables; epoch-ms INTEGER in Better Auth's", () => {
    // *_at catches every timestamp column either lineage uses (created_at, updated_at, expires_at,
    // dispatched_at, recorded_at, …). Better Auth-owned tables are the scoped exception — their
    // drizzle adapter reads and writes epoch-millisecond integers (mode "timestamp_ms").
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      const expectedType = BETTER_AUTH_TABLE_NAMES.has(config.name) ? "integer" : "text";
      for (const column of config.columns) {
        if (column.name.endsWith("_at")) {
          expect(column.getSQLType(), `${config.name}.${column.name}`).toBe(expectedType);
        }
      }
    }
  });

  it("money-ish column names must use the storage-encoding suffixes (*_minor / *_rate_e4)", () => {
    const moneyName = /(amount|balance|total|price|fee|cost)(_|$)/;
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (moneyName.test(column.name)) {
          const suffixed = column.name.endsWith("_minor") || column.name.endsWith("_rate_e4");
          expect(suffixed, `${config.name}.${column.name} must be *_minor or *_rate_e4`).toBe(true);
        }
      }
    }
  });
});
