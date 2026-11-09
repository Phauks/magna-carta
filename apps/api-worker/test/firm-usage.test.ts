import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Usage Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("GET /api/v1/firm-usage", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:firmUsage", async () => {
    // Never mirrored into a role → present (not deactivated) but holds no permission → 403, not 404.
    await seedCredentialedUser("usage-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("usage-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns the composed snapshot for an Admin member", async () => {
    const { userId } = await seedCredentialedUser("usage-ok@example.com", {
      userName: "Usage OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Usage OK", poolFirmId); // Admin carries tools:firmUsage (0006)
    const t = "2026-01-01T00:00:00.000Z";
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
    await firmDatabase
      .prepare(
        "INSERT INTO storage_meter (storage_class, artifact_role, prefix, bytes, object_count) VALUES ('standard','original','files',1000,1)",
      )
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES ('matter_u','M',NULL,'open',NULL,NULL,?1,NULL,NULL,NULL,NULL,NULL,NULL,?2,?2)",
      )
      .bind(userId, t)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO location (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES ('loc_u','HQ','active',NULL,NULL,NULL,NULL,NULL,?1,?1)",
      )
      .bind(t)
      .run();
    // One matter typed and located, so the by-type and by-location rollups have a non-null row each.
    await firmDatabase
      .prepare(
        "INSERT INTO matter_type (id, name, code, active, created_at, updated_at) VALUES ('matterType_u','Estate Planning',NULL,1,?1,?1)",
      )
      .bind(t)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES ('matter_u2','M2',NULL,'open','matterType_u','loc_u',?1,NULL,NULL,NULL,NULL,NULL,NULL,?2,?2)",
      )
      .bind(userId, t)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO member_location (id, member_user_id, location_id, is_primary, created_at) VALUES ('memberLocation_u',?1,'loc_u',1,?2)",
      )
      .bind(userId, t)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES ('directoryPerson_u','Pat Example',?1,?1)",
      )
      .bind(t)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO directory_organization (id, display_name, created_at, updated_at) VALUES ('directoryOrganization_u','Example Court',?1,?1)",
      )
      .bind(t)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO token_usage_meter (day, slot, model_id, input_tokens, output_tokens, request_count) VALUES ('2026-01-01','reasoning','test/model',100,50,2)",
      )
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO ai_search_usage_meter (day, semantic_query_count, full_text_query_count, fed_bytes, estimated_ingestion_tokens, estimated_ingestion_bytes_per_token) VALUES ('2026-01-01',3,4,0,0,0)",
      )
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO ai_detection_usage (id, requested_by, word_count, mode, cost_minor, adapter_id, vendor_version, result_band, matter_id, created_at) VALUES ('aiDetectionUsage_u',?1,250,'realtime',3,'test',NULL,NULL,NULL,?2)",
      )
      .bind(userId, t)
      .run();
    // A custody tree that exercises the office rollup's walk: an HQ root binding loc_u with a shelf
    // under it holding one item; a second packet checked out (no location, so it counts nowhere);
    // and an offsite root binding no office, whose item lands in the offsite bucket.
    for (const statement of [
      "INSERT INTO custody_location (id, name, kind, parent_location_id, firm_location_id, address, status, notes, created_at, updated_at) VALUES ('custodyLocation_root','HQ Vault','office',NULL,'loc_u',NULL,'active',NULL,?1,?1)",
      "INSERT INTO custody_location (id, name, kind, parent_location_id, firm_location_id, address, status, notes, created_at, updated_at) VALUES ('custodyLocation_shelf','Shelf A','shelf','custodyLocation_root',NULL,NULL,'active',NULL,?1,?1)",
      "INSERT INTO custody_location (id, name, kind, parent_location_id, firm_location_id, address, status, notes, created_at, updated_at) VALUES ('custodyLocation_bank','Bank Vault','bank',NULL,NULL,NULL,'active',NULL,?1,?1)",
      "INSERT INTO custody_packet (id, custody_number, number_source, name, current_location_id, status, matter_id, depositor_entity_id, deposited_at, notes, created_at, updated_at) VALUES ('custodyPacket_u','CUS-00001','manual','Example Wallet','custodyLocation_shelf','held',NULL,NULL,NULL,NULL,?1,?1)",
      "INSERT INTO custody_packet (id, custody_number, number_source, name, current_location_id, status, matter_id, depositor_entity_id, deposited_at, notes, created_at, updated_at) VALUES ('custodyPacket_out','CUS-00002','manual','Deed Out',NULL,'out',NULL,NULL,NULL,NULL,?1,?1)",
      "INSERT INTO custody_packet (id, custody_number, number_source, name, current_location_id, status, matter_id, depositor_entity_id, deposited_at, notes, created_at, updated_at) VALUES ('custodyPacket_bank','CUS-00003','manual','Deposited Deed','custodyLocation_bank','held',NULL,NULL,NULL,NULL,?1,?1)",
      "INSERT INTO custody_item (id, packet_id, ordinal, item_type_id, description, instrument_date, intrinsic_value, declared_value_amount_minor, declared_value_currency, status, created_at, updated_at) VALUES ('custodyItem_u','custodyPacket_u',1,NULL,'Original will',NULL,0,NULL,NULL,'held',?1,?1)",
      "INSERT INTO custody_item (id, packet_id, ordinal, item_type_id, description, instrument_date, intrinsic_value, declared_value_amount_minor, declared_value_currency, status, created_at, updated_at) VALUES ('custodyItem_out','custodyPacket_out',1,NULL,'Deed at completion',NULL,0,NULL,NULL,'out',?1,?1)",
      "INSERT INTO custody_item (id, packet_id, ordinal, item_type_id, description, instrument_date, intrinsic_value, declared_value_amount_minor, declared_value_currency, status, created_at, updated_at) VALUES ('custodyItem_bank','custodyPacket_bank',1,NULL,'Deposited deed',NULL,0,NULL,NULL,'held',?1,?1)",
    ]) {
      await firmDatabase.prepare(statement).bind(t).run();
    }

    const cookie = await signInForSessionCookie("usage-ok@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      storage: {
        totalBytes: 1000,
        totalObjects: 1,
        byStorageClass: {
          standard: { bytes: 1000, objects: 1 },
          infrequent_access: { bytes: 0, objects: 0 },
        },
      },
      counts: {
        matters: { total: 2, intake: 0, consultation: 0, open: 2, hold: 0, closed: 0 },
        files: 0,
        fileVersions: 0,
        folders: 0,
        locations: 1,
      },
      mattersByType: [
        // Equal totals tie-break on name, and the no-type bucket sorts as the empty string.
        { matterTypeName: null, intake: 0, consultation: 0, open: 1, hold: 0, closed: 0, total: 1 },
        {
          matterTypeName: "Estate Planning",
          intake: 0,
          consultation: 0,
          open: 1,
          hold: 0,
          closed: 0,
          total: 1,
        },
      ],
      files: {
        currentFiles: { count: 0, bytes: 0 },
        priorVersions: { count: 0, bytes: 0 },
        allVersions: { count: 0, bytes: 0 },
        deletedFiles: { count: 0, bytes: 0 },
      },
      byLocation: {
        rows: [{ name: "HQ", status: "active", matters: 1, members: 1, custodyItems: 1 }],
        mattersWithoutLocation: 1,
        custodyItemsOffsite: 1,
      },
      directory: { people: 1, organizations: 1, activeMembers: 1 },
      aiUsage: {
        magnusTokens: { inputTokens: 100, outputTokens: 50, requests: 2 },
        searchQueries: { semantic: 3, fullText: 4 },
        detection: { requests: 1, words: 250 },
        notMetered: ["managed index storage"],
      },
    });
  });

  it("emits the route into the OpenAPI document with operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/firm-usage"]?.get;
    expect(operation?.["operationId"]).toBe("firmUsage.get");
    expect(operation).toMatchObject({
      "x-mc-operationId": "firmUsage.get",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "tools:firmUsage",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });
});
