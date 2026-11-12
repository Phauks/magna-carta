// @repo-wide-fitness — the naming, timestamp and composite-key rules bind every table in both
// lineages; the schema is one file but the tables in it arrive from every slice in the repository.
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
    //  - time_entry_number_counter: the per-matter time-entry sequence, keyed by its scope (the
    //    matter id) — the same counter shape again.
    //  - conflicts_check_number_counter: the conflicts check sequence, keyed by its scope — the same
    //    counter shape once more, now that a check number is drawn from a scheme like a matter's.
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
      time_entry_number_counter: "scope_key",
      communication_number_counter: "scope_key",
      conflicts_check_number_counter: "scope_key",
      setting: "key",
      // The firm's limit is keyed by what it limits: an event type's id, or deadlines as one kind.
      calendar_sync_firm_limit: "subject",
      platform_operator: "user_id",
      // The community board's display identity: one per person, keyed by the GLOBAL user handle,
      // the same idiom as platform_operator.
      community_profile: "user_id",
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
      // One managed natural-language search instance per firm, and the FIRM is the row. A separate
      // handle would let two rows exist for one firm, which is exactly the state that cannot be
      // allowed: the row is the platform's own catalog of what exists in its account, and the instance
      // name is derived from the firm identifier so a second row could only ever name the same
      // instance or an orphaned one.
      ai_search_instance: "firm_id",
      // The firm's acknowledgement of the search disclosure, and there is exactly one. The per-firm
      // database IS the firm, so the row is keyed by a fixed literal scope rather than a handle — the
      // same idiom as `setting` keyed by its key — which makes the write a plain upsert with no read
      // first and makes two acceptances unrepresentable.
      ai_search_disclosure_acknowledgement: "scope",
      // One professional profile per member, and the member IS the row — a second handle would let
      // two profiles exist for one person, and every read already arrives holding the user id.
      member_professional_profile: "member_user_id",
      // One destruction date per matter's paper file, and the matter IS the row — a second handle
      // would let two dates exist for one file, which is exactly the ambiguity a date somebody
      // destroys a file on must never carry.
      matter_file_retention: "matter_id",
      // One picture per member, and the member IS the row — a second handle would let two pictures
      // exist for one person, which is exactly the state a roster must never have to choose between.
      // Deliberately NOT keyed by the bytes' hash the way firm_brand_image is: two members may
      // legitimately hold the same image, and keying on content would make one member's upload
      // silently become the other's row.
      member_photo: "member_user_id",
      // One picture per directory record, and the record IS the row: the member_photo reasoning, for
      // a person's photograph or an organization's logo.
      directory_entity_photo: "entity_id",
      // One running tally per member of how many notifications aged out of their feed while still
      // unread. The MEMBER is the row: it is a count and two instants updated in place, never an
      // event anybody appends, and a handle would let two tallies exist for one person — which is
      // exactly the state the unread count must never have to reconcile.
      notification_swept_unread: "recipient_user_id",
      // The natural-language search usage meter, keyed by the civil day it rolls up. The DAY is the
      // row: it is a tally updated in place by delta, never an event anybody appends, so a handle
      // would let two tallies exist for one day — the one state a meter must never have to
      // reconcile. Same idiom as storage_meter and token_usage_meter, which key by what they roll up.
      ai_search_usage_meter: "day",
    };
    // storage_meter is keyed by WHAT it rolls up — a composite natural key, no handle. Still all TEXT.
    // token_usage_meter is the same shape — keyed by (day, slot, model_id), all TEXT, append-by-delta.
    // directory_name_phonetic_code is keyed by (name_id, scheme) — a phonetic code row IS its
    // (name, scheme) pair; a separate handle would add nothing and would cost a unique lookup at every
    // phonetic-search join.
    // nickname_equivalence is keyed (name_form, equivalent_form) — a curated pair IS the row.
    // directory_entity_category is the many-to-many join between a directory entity and a category —
    // the pair (entity_id, category_id) is the natural key; no handle is warranted.
    // scan_cache is keyed by the content hash + engine version whose verdict it caches.
    // scoped_setting is keyed by (key, scope_tier, scoped_id) — the triple IS the identity of a
    // setting row (which key, at which scope tier, for which scoped entity); a separate handle
    // would add nothing and every read would need an extra join to find a row by its natural triple.
    // matter_number_allocation is keyed by (scope_key, drawn_value) — the counter value a matter
    // number draw consumed, in the scope it came from. That pair IS the reservation; a handle would
    // add nothing and would need a unique lookup on every draw to find the row by its natural pair.
    // invoice_number_allocation is the same reservation shape for invoice numbers, and
    // time_entry_number_allocation the same again for entry numbers.
    // time_entry_attachment is the many-to-many join between an entry and the matter's files — the
    // pair (time_entry_id, file_id) is the natural key; a handle would let one file attach twice.
    // invoice_matter_balance is keyed by (invoice_id, matter_id) — the derived balance IS that pair,
    // exactly as account_balance IS its account; every read and every delta arrives holding both.
    // document_template_field_binding is keyed by (template_version_id, merge_key) — a binding IS that
    // pair, there is nothing else to record about one, and both directions of the question ("what does
    // this version bind", "who binds this field") arrive holding one of the two columns.
    // index_split_member is keyed by (split_id, document_id, version) — a membership IS "this document
    // version is inside this split". There is nothing else to record about one, both directions of the
    // question arrive holding one of the columns, and a handle would need a unique lookup on the triple
    // at every re-index to find the row to mark stale.
    // notification_in_app_suppression is keyed by (recipient_user_id, category, civil_date, reason) —
    // a running count of what one member's settings stopped, in one category, on one day, for one
    // reason. The quadruple IS the row: it is a tally updated in place rather than an event anybody
    // appends, and a handle would let two tallies exist for the same day and category, which is the
    // one state a count must never have to reconcile.
    // ai_search_feed_object is keyed by (file_id, version) — one fed object per committed document
    // version, and that pair IS the row. A handle would let two rows describe the same version, which
    // is precisely the state the deletion plan and the pending-document count must never have to
    // reconcile; the write is an upsert on this key, which is what makes a retried feed write converge
    // rather than leave a second copy.
    // magnus_conversation_attachment is keyed by (conversation_id, file_id) — the same many-to-many
    // shape as time_entry_attachment, and exempt for the same reason. A conversation holds a file or
    // it does not; the pair IS the attachment, and a handle would let one file attach to the same
    // conversation twice, which is the one state the per-file outcome the composer reports could not
    // then reconcile.
    // file_version_participant is the many-to-many join between a version and the members who were
    // in the editing session when it was cut — the pair (version_id, member_user_id) is the natural
    // key, same idiom as directory_entity_category; no handle is warranted.
    // file_version_change is one tracked change of a version, keyed by (version_id, sequence): its
    // document order within the version IS its identity, and nothing references a change row.
    // caller_identity is keyed by (country_calling_code, national_number) — the network's answer
    // about one number, and the number IS the row. A handle would let two answers exist for one
    // number, and the write is an upsert on this key so a second paid lookup replaces the first.
    const compositeKeyTables = new Set([
      "caller_identity",
      "file_version_participant",
      "file_version_change",
      "ai_search_feed_object",
      "magnus_conversation_attachment",
      "storage_meter",
      "token_usage_meter",
      "directory_name_phonetic_code",
      "nickname_equivalence",
      "directory_entity_category",
      "matter_number_allocation",
      "custody_number_allocation",
      "invoice_number_allocation",
      "time_entry_number_allocation",
      "conflicts_check_number_allocation",
      "time_entry_attachment",
      "magnus_conversation_attachment",
      "invoice_matter_balance",
      "document_template_field_binding",
      "scan_cache",
      "scoped_setting",
      "index_split_member",
      "notification_in_app_suppression",
      // What a conversation has been given to read: the pair IS the fact, and a file is attached to
      // a conversation once, so a surrogate key would let the same attachment exist twice.
      "magnus_conversation_attachment",
      // A community vote: one per person per post, so the pair IS the vote.
      "community_vote",
      // A list's flow, a team's membership and a task's watchers are each the pair itself: a move is
      // allowed once, a member is on a team once, a member watches a task once.
      "task_list_status_transition",
      "task_team_member",
      "matter_task_watcher",
      // A member's rule is the pair itself: one connected account sends one subject to one place.
      "calendar_sync_rule",
      // A copy at a provider is the pair of one event and one connected account.
      "calendar_sync_link",
      // A question about a copy is keyed as the copy is, so a copy never has two.
      "connection_sync_issue",
      // Where a record came from is the pair itself: one source record is linked once to each kind
      // of record it became, so a surrogate key would let the same link exist twice.
      "source_record_link",
      // A member's choice is the pair of their account and one of its calendars.
      "calendar_sync_shown_calendar",
      // A member's own event is the pair of their account and the provider's identifier for it.
      "external_calendar_event",
      // A comment names a colleague once.
      "matter_task_comment_mention",
    ]);
    // Composite key columns are TEXT with a few documented exceptions, all the same shape: the column IS
    // a number and constraining it as one is the entire point. The value a number draw reserves is a
    // counter — a string spelling of it would let '01' and '1' both be drawn — and a file's version is
    // the same integer the file entry and index_split already carry, so spelling it as text here would
    // make the membership disagree with the split row it describes.
    const integerCompositeKeyColumns = new Set([
      // A change's place in its version's document order is a count, and ORDER BY on it must sort
      // numerically: '10' before '2' would read a document backwards.
      "file_version_change.sequence",
      "matter_number_allocation.drawn_value",
      "custody_number_allocation.drawn_value",
      "invoice_number_allocation.drawn_value",
      "time_entry_number_allocation.drawn_value",
      "conflicts_check_number_allocation.drawn_value",
      "index_split_member.version",
      // A fed object's version is the same integer the file entry and the split catalog already carry;
      // spelling it as text here would let the feed row disagree with the split row about which
      // version of a document it describes.
      "ai_search_feed_object.version",
    ]);

    // Tables keyed by an INTEGER because a full-text table is keyed by one. A full-text table's rows
    // are addressed by row id and nothing else, so the ordinary table that says what each of its rows
    // IS has to carry that same integer as its key. It is never a handle: nothing outside the index
    // refers to it, no route returns it, and a rebuild assigns new ones.
    const integerRowIdentifierTables = new Set(["record_text_entry"]);

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
      expect(primaryColumns[0]?.getSQLType(), config.name).toBe(
        integerRowIdentifierTables.has(config.name) ? "integer" : "text",
      );
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
