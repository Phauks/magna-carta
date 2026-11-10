import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertIndexSplitStatement } from "@magna-carta/data-access/index-split-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FirmId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { recordIndexSources } from "@magna-carta/search/record-index-sources";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// What a firm's indexes hold, over the route the settings page reads: every searchable place with
// its counts, the files the file contents index holds out of those that belong in it, and the two
// switches, each counted from the firm's own database at the moment of the read.

let poolFirmId: FirmId;
let ownerUserId: string;
let ownerCookie: string;
let matterId: MatterId;

const ROUTE = "https://example.com/api/v1/firm/search-status";
const NOW = "2026-06-22T12:00:00.000Z";

interface StatusBody {
  checkedAt: string;
  records: {
    places: {
      key: string;
      label: string;
      matchedFields: string[];
      readBy: string[];
      indexed: number;
      expected: number;
    }[];
  };
  fileContents: {
    turnedOn: boolean;
    serviceConnected: boolean;
    filesBelonging: number;
    filesIndexed: number;
    lastIndexedAt: string | null;
    dailyCatchUpLimit: number;
  };
  searchByMeaning: { turnedOn: boolean; serviceConnected: boolean };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Search Status Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  const { userId } = await seedCredentialedUser("search-status-owner@example.com", {
    userName: "Search Status Owner",
    firmId: poolFirmId,
  });
  ownerUserId = userId;
  await mirrorMemberWithOwnerRole(userId, "Search Status Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("search-status-owner@example.com");
  matterId = newIdentifier("matter") as MatterId;
  await database()
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Search Status Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, NOW)
    .run();
});

function database() {
  return firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
}

async function readStatus(): Promise<StatusBody> {
  const response = await SELF.fetch(ROUTE, { headers: { cookie: ownerCookie } });
  expect(response.status).toBe(200);
  return response.json<StatusBody>();
}

async function seedNote(body: string): Promise<string> {
  const id = newIdentifier("matterNote");
  await database()
    .prepare(
      "INSERT INTO matter_note (id, matter_id, author_user_id, body, occurred_on, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)",
    )
    .bind(id, matterId, ownerUserId, body, NOW)
    .run();
  return id;
}

// A committed, clean, current version of a file on the matter: what the file contents index is for.
async function seedCommittedDocument(name: string): Promise<FileId> {
  const fileId = newIdentifier("file") as FileId;
  const versionId = newIdentifier("fileVersion");
  await database()
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, NULL, ?4, ?4, NULL)",
    )
    .bind(fileId, matterId, name, NOW)
    .run();
  await database()
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, storage_class, status, uploaded_by, created_at, committed_at, sniffed_content_type) VALUES (?1, ?2, 1, ?3, 100, ?4, 'standard', 'clean', ?5, ?6, ?6, 'application/pdf')",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, `hash-${fileId}`, ownerUserId, NOW)
    .run();
  await database()
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return fileId;
}

describe("GET /api/v1/firm/search-status", () => {
  it("lists every searchable place for a fresh firm, each holding nothing and owed nothing", async () => {
    const status = await readStatus();

    expect(status.records.places.map((place) => place.key)).toEqual(
      recordIndexSources.map((source) => source.key),
    );
    for (const place of status.records.places) {
      expect(place).toMatchObject({ indexed: 0, expected: 0 });
      expect(place.label.length).toBeGreaterThan(0);
      expect(place.matchedFields.length).toBeGreaterThan(0);
    }
    expect(status.fileContents).toEqual({
      turnedOn: false,
      serviceConnected: false,
      filesBelonging: 0,
      filesIndexed: 0,
      lastIndexedAt: null,
      dailyCatchUpLimit: 1000,
    });
    expect(status.searchByMeaning).toEqual({ turnedOn: false, serviceConnected: false });
    expect(Number.isNaN(Date.parse(status.checkedAt))).toBe(false);
  });

  it("counts a place's records as they are written, with who reads the place", async () => {
    await seedNote("The covenant runs with the land.");
    await seedNote("A second note about the easement.");

    const notes = (await readStatus()).records.places.find((place) => place.key === "notes");
    expect(notes).toMatchObject({
      label: "Notes",
      readBy: ["matter-search"],
      indexed: 2,
      expected: 2,
    });
  });

  it("shows a place whose index has fallen behind its records", async () => {
    const lost = await seedNote("A note whose index row is about to be lost.");
    // Something no write path does: the index row removed behind the record's back.
    await database()
      .prepare(
        "DELETE FROM record_text_fts WHERE rowid IN (SELECT id FROM record_text_entry WHERE record_id = ?1)",
      )
      .bind(lost)
      .run();
    await database().prepare("DELETE FROM record_text_entry WHERE record_id = ?1").bind(lost).run();

    const notes = (await readStatus()).records.places.find((place) => place.key === "notes");
    expect(notes).toMatchObject({ indexed: 2, expected: 3 });
  });

  it("counts the files that belong in the file contents index and the ones it holds", async () => {
    const indexed = await seedCommittedDocument("Lease Agreement.pdf");
    await seedCommittedDocument("Scanned Deed.pdf");
    await insertIndexSplitStatement(database(), {
      id: `split_${indexed}` as IndexSplitId,
      matterId,
      corpusKind: "matter",
      corpusId: matterId,
      documentId: indexed,
      version: 1,
      objectKey: `search/${matterId}/splits/split_${indexed}.split`,
      documentCount: 1,
      sizeBytes: 1,
      schemaGeneration: 2,
      createdAt: NOW,
    }).run();

    expect((await readStatus()).fileContents).toMatchObject({
      filesBelonging: 2,
      filesIndexed: 1,
      lastIndexedAt: NOW,
    });
  });

  it("says a service is connected when the deployment binds one", async () => {
    const response = await createApp().request(
      ROUTE,
      { headers: { cookie: ownerCookie } },
      { ...env, SEARCH_SERVICE: { fetch: async () => new Response(null, { status: 503 }) } },
    );
    expect(response.status).toBe(200);
    expect((await response.json<StatusBody>()).fileContents.serviceConnected).toBe(true);
  });

  it("returns 403 for an authenticated member without firm:manageSearchSettings", async () => {
    await seedCredentialedUser("search-status-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("search-status-noperm@example.com");
    const response = await SELF.fetch(ROUTE, { headers: { cookie } });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns 401 without a session", async () => {
    expect((await SELF.fetch(ROUTE)).status).toBe(401);
  });
});
