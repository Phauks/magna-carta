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

// A matter's Bates logs driven through the chokepoint over real Miniflare bindings: two logs count
// on their own, two stamps take consecutive ranges, a typed start inside a stamped range is refused, the saved copy is
// recorded once, and a member with no role can read nothing. This block seeds its own firm, because
// the rate-limit key is per firm.

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

// A file with a clean version, seeded directly: no Bates route accepts bytes.
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

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Bates Test Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("bates-owner@example.com", {
    userName: "Bates Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Bates Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("bates-owner@example.com");

  const outsider = await seedCredentialedUser("bates-outsider@example.com", {
    userName: "Bates Outsider",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: outsider.userId,
    displayName: "Bates Outsider",
    now: now(),
  }).run();
  outsiderCookie = await signInForSessionCookie("bates-outsider@example.com");

  const matter = await send("POST", "/api/v1/matters", {
    title: "Alvarez v. Northgate",
    status: "consultation",
    responsibleMemberId: ownerUserId,
  });
  expect(matter.status).toBe(201);
  matterId = ((await matter.json()) as { matterId: string }).matterId;
});

async function startLog(name: string, prefix: string, digits = 6): Promise<string> {
  const response = await send("POST", `/api/v1/matters/${matterId}/bates-logs`, {
    name,
    prefix,
    digits,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

interface Taken {
  id: string;
  firstNumber: number;
  lastNumber: number;
}

describe("a matter's Bates logs", () => {
  it("hands out consecutive ranges, refuses a stamped number, and records the copy once", async () => {
    const log = await startLog("Motion to Compel", "ALV-");
    const lease = await seedCleanFile("Lease.pdf");
    const first = await send("POST", `/api/v1/matters/${matterId}/bates-ranges`, {
      logId: log,
      pageCount: 12,
      purpose: "pdfEditor",
      sourceFileId: lease,
    });
    expect(first.status).toBe(201);
    const taken = (await first.json()) as Taken;
    expect(taken).toMatchObject({ firstNumber: 1, lastNumber: 12 });

    const second = await send("POST", `/api/v1/matters/${matterId}/bates-ranges`, {
      logId: log,
      pageCount: 3,
      purpose: "pdfEditor",
    });
    expect(((await second.json()) as Taken).firstNumber).toBe(13);

    const clash = await send("POST", `/api/v1/matters/${matterId}/bates-ranges`, {
      logId: log,
      pageCount: 2,
      firstNumber: 10,
      purpose: "pdfEditor",
    });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { type: string; detail: string }).detail).toContain("16");

    const stamped = await seedCleanFile("Lease (ALV-000001 to ALV-000012).pdf");
    const path = `/api/v1/matters/${matterId}/bates-ranges/${taken.id}/stamped-file`;
    expect((await send("POST", path, { fileId: stamped })).status).toBe(200);
    expect((await send("POST", path, { fileId: stamped })).status).toBe(409);

    // A second filing under the same prefix counts on its own, and a name is used once.
    const trial = await startLog("Trial Exhibits", "ALV-");
    const trialTake = await send("POST", `/api/v1/matters/${matterId}/bates-ranges`, {
      logId: trial,
      pageCount: 2,
      purpose: "exhibitPackage",
    });
    expect(((await trialTake.json()) as Taken).firstNumber).toBe(1);
    const duplicate = await send("POST", `/api/v1/matters/${matterId}/bates-logs`, {
      name: "Trial Exhibits",
      prefix: "",
      digits: 4,
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { type: string }).type).toContain("bates-log-name-taken");
    const renamed = await send("PATCH", `/api/v1/matters/${matterId}/bates-logs/${trial}`, {
      name: "Trial Exhibits (Plaintiff)",
    });
    expect(renamed.status).toBe(200);

    const logs = await get(`/api/v1/matters/${matterId}/bates-logs`);
    expect(logs.status).toBe(200);
    const listed = (await logs.json()) as { data: { name: string; nextNumber: number }[] };
    expect(listed.data.find((row) => row.name === "Motion to Compel")?.nextNumber).toBe(16);
    expect(listed.data.find((row) => row.name === "Trial Exhibits (Plaintiff)")?.nextNumber).toBe(
      3,
    );
    const ranges = await get(`/api/v1/matters/${matterId}/bates-ranges`);
    const page = (await ranges.json()) as { data: { stampedFileName: string | null }[] };
    expect(page.data.map((range) => range.stampedFileName)).toContain(
      "Lease (ALV-000001 to ALV-000012).pdf",
    );
  });

  it("answers a retried take with the range it took rather than a second one", async () => {
    const key = crypto.randomUUID();
    const body = {
      logId: await startLog("Retry", "RETRY-", 4),
      pageCount: 5,
      purpose: "pdfEditor",
    };
    const once = await send(
      "POST",
      `/api/v1/matters/${matterId}/bates-ranges`,
      body,
      ownerCookie,
      key,
    );
    const twice = await send(
      "POST",
      `/api/v1/matters/${matterId}/bates-ranges`,
      body,
      ownerCookie,
      key,
    );
    expect(await twice.json()).toEqual(await once.json());
    const next = await send("POST", `/api/v1/matters/${matterId}/bates-ranges`, body);
    expect(((await next.json()) as Taken).firstNumber).toBe(6);
  });

  it("refuses a take from a member who may not add files", async () => {
    const response = await send(
      "POST",
      `/api/v1/matters/${matterId}/bates-ranges`,
      { logId: await startLog("Outsider", "X", 4), pageCount: 1, purpose: "pdfEditor" },
      outsiderCookie,
    );
    expect(response.status).toBe(403);
  });
});
