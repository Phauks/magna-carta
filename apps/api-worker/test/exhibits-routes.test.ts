import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The exhibit surface driven through the chokepoint over real Miniflare bindings: a member makes
// three exhibits from files already on the matter, puts them in a set, reorders it, issues it, and
// finds that nothing about the issued set can be moved afterwards. This block seeds its own firm,
// because the rate-limit key is per firm.

let firmId: FirmId;
let ownerCookie: string;
let outsiderCookie: string;
let ownerUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let matterId: string;

const now = () => new Date().toISOString();

function headers(cookie: string, idempotencyKey?: string): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
  };
}

function send(
  method: string,
  path: string,
  body?: unknown,
  cookie = ownerCookie,
  key: string | null = crypto.randomUUID(),
) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: headers(cookie, key ?? undefined),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

// A file with a clean version, seeded directly: no exhibit route accepts bytes, so the handle the
// file surface would have produced is what the test starts from.
async function seedCleanFile(name: string): Promise<string> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) " +
        "VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, matterId, name, now())
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, status, created_at) VALUES (?1, ?2, 1, ?3, 'clean', ?4)",
    )
    .bind(versionId, fileId, `r2/${versionId}`, now())
    .run();
  await firmDatabase
    .prepare("UPDATE file SET current_version_id = ?1 WHERE id = ?2")
    .bind(versionId, fileId)
    .run();
  return fileId;
}

async function createExhibit(title: string): Promise<string> {
  const fileId = await seedCleanFile(`${title}.pdf`);
  const response = await send("POST", `/api/v1/matters/${matterId}/exhibits`, { fileId, title });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

interface SetDetail {
  state: string;
  members: { id: string; label: string; title: string }[];
}

async function readSet(setId: string): Promise<SetDetail> {
  const response = await get(`/api/v1/matters/${matterId}/exhibit-sets/${setId}`);
  expect(response.status).toBe(200);
  return (await response.json()) as SetDetail;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Exhibits Test Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("exhibits-owner@example.com", {
    userName: "Exhibits Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Exhibits Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("exhibits-owner@example.com");

  // A member of the firm with no role and no grant: signed in, and allowed nothing here.
  const outsider = await seedCredentialedUser("exhibits-outsider@example.com", {
    userName: "Exhibits Outsider",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: outsider.userId,
    displayName: "Exhibits Outsider",
    now: now(),
  }).run();
  outsiderCookie = await signInForSessionCookie("exhibits-outsider@example.com");

  const matter = await send("POST", "/api/v1/matters", {
    title: "Alvarez v. Northgate",
    status: "consultation",
    responsibleMemberId: ownerUserId,
  });
  expect(matter.status).toBe(201);
  matterId = ((await matter.json()) as { matterId: string }).matterId;
});

describe("building and issuing an exhibit set", () => {
  it("labels a draft by its order, relabels on reorder, and freezes the labels at issue", async () => {
    const contract = await createExhibit("Purchase contract");
    const letter = await createExhibit("Demand letter");
    const invoice = await createExhibit("Unpaid invoice");

    const created = await send("POST", `/api/v1/matters/${matterId}/exhibit-sets`, {
      name: "Plaintiff's exhibits to the motion",
    });
    expect(created.status).toBe(201);
    const setId = ((await created.json()) as { id: string }).id;

    const added = await send("POST", `/api/v1/matters/${matterId}/exhibit-sets/${setId}/members`, {
      exhibitIds: [contract, letter, invoice],
    });
    expect(added.status).toBe(201);

    const draft = await readSet(setId);
    expect(draft.members.map((member) => [member.title, member.label])).toEqual([
      ["Purchase contract", "A"],
      ["Demand letter", "B"],
      ["Unpaid invoice", "C"],
    ]);

    const reversed = draft.members.map((member) => member.id).reverse();
    const reordered = await send("PUT", `/api/v1/matters/${matterId}/exhibit-sets/${setId}/order`, {
      memberIds: reversed,
    });
    expect(reordered.status).toBe(200);
    const after = await readSet(setId);
    expect(after.members.map((member) => [member.title, member.label])).toEqual([
      ["Unpaid invoice", "A"],
      ["Demand letter", "B"],
      ["Purchase contract", "C"],
    ]);

    const issueKey = crypto.randomUUID();
    const issueBody = { disposition: "filed", issuedOn: "2026-11-13" };
    const issued = await send(
      "POST",
      `/api/v1/matters/${matterId}/exhibit-sets/${setId}/issue`,
      issueBody,
      ownerCookie,
      issueKey,
    );
    expect(issued.status).toBe(200);
    const frozen = (await issued.json()) as { labels: { label: string }[] };
    expect(frozen.labels.map((entry) => entry.label)).toEqual(["A", "B", "C"]);

    // A retried issue answers with the labels it froze, rather than refusing its own success.
    const retried = await send(
      "POST",
      `/api/v1/matters/${matterId}/exhibit-sets/${setId}/issue`,
      issueBody,
      ownerCookie,
      issueKey,
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(frozen);

    const refusedReorder = await send(
      "PUT",
      `/api/v1/matters/${matterId}/exhibit-sets/${setId}/order`,
      { memberIds: draft.members.map((member) => member.id) },
    );
    expect(refusedReorder.status).toBe(409);
    expect(((await refusedReorder.json()) as { type: string }).type).toContain("exhibit-set-issued");

    const refusedRemoval = await send(
      "DELETE",
      `/api/v1/matters/${matterId}/exhibit-sets/${setId}/members/${after.members[0]?.id}`,
    );
    expect(refusedRemoval.status).toBe(409);

    const issuedSet = await readSet(setId);
    expect(issuedSet.state).toBe("issued");
    expect(issuedSet.members.map((member) => member.label)).toEqual(["A", "B", "C"]);
  });

  it("refuses a file that has no clean version", async () => {
    const fileId = newIdentifier("file");
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) " +
          "VALUES (?1, ?2, NULL, 'unscanned.pdf', NULL, NULL, NULL, ?3, ?3)",
      )
      .bind(fileId, matterId, now())
      .run();
    const response = await send("POST", `/api/v1/matters/${matterId}/exhibits`, {
      fileId,
      title: "Not yet scanned",
    });
    expect(response.status).toBe(422);
  });
});

describe("the chokepoint in front of exhibits", () => {
  it("answers 401 without a session", async () => {
    const response = await SELF.fetch(`https://example.com/api/v1/matters/${matterId}/exhibits`, {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
  });

  it("answers 403 to a member without the exhibit permission", async () => {
    const response = await get(`/api/v1/matters/${matterId}/exhibits`, outsiderCookie);
    expect(response.status).toBe(403);
  });

  it("refuses a write with no Idempotency-Key", async () => {
    const response = await send(
      "POST",
      `/api/v1/matters/${matterId}/exhibit-sets`,
      { name: "No key" },
      ownerCookie,
      null,
    );
    expect(response.status).toBe(400);
  });

  it("answers 404 for a set that does not exist", async () => {
    const response = await get(
      `/api/v1/matters/${matterId}/exhibit-sets/${newIdentifier("exhibitSet")}`,
    );
    expect(response.status).toBe(404);
  });
});
