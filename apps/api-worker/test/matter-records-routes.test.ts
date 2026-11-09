import { env, SELF } from "cloudflare:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import { beforeAll, describe, expect, it } from "vitest";
import { insertDocumentAssemblyStatement } from "@magna-carta/document-assembly/assembly-statements";
import { documentAssemblyQueue } from "../src/background/assemblies/assembly-consumer.ts";
import type { DocumentAssemblyMessage } from "../src/assemblies/assembly-types.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The matter's identity records beyond the shell — staffing assignments, the court-case record, the
// estate record, the party capacity, and the member professional profile — written through their
// routes and read back by the merge engine end to end. The protected half is the part only this
// suite can prove: a supervising attorney's bar number is decrypted through the real chokepoint
// with the real audit row, refused with a named reason for a member without the permission, and —
// the rule this slice adds — never even attempted for a staffing slot that resolved ambiguously.

const SEALED_BAR_NUMBER = "14212";
const BAR_NUMBER_KEY = "supervisingAttorney.barNumber";

let firmId: FirmId;
let bucketName: string;
let ownerCookie: string;
let ownerUserId: UserId;
let paralegalUserId: UserId;
let supervisorUserId: UserId;
let supervisorEntityId: string;
let identifierRowId: string;
let matterId: string;
let templateVersionId: string;
let templateIdOfVersion: string;

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_NAMESPACE = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const MAIN_DOCUMENT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

function templateDocx(body: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(
      `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    ),
    "word/document.xml": strToU8(
      `${DECLARATION}<w:document ${WORD_NAMESPACE}><w:body><w:p><w:r><w:t xml:space="preserve">${body}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  });
}

function headers(cookie: string, withIdempotencyKey: boolean): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withIdempotencyKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: headers(cookie, true),
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: headers(cookie, true),
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function queryFirstRow<T>(sql: string, bindings: readonly unknown[]): Promise<T | undefined> {
  const result = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(sql)
    .bind(...bindings)
    .all<T>();
  return result.results[0];
}

async function decryptAuditCount(subjectId: string): Promise<number> {
  const row = await queryFirstRow<{ count: number }>(
    "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1",
    [subjectId],
  );
  return row?.count ?? 0;
}

async function mirrorMemberWithRole(
  userId: UserId,
  displayName: string,
  roleName: string,
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const roleResult = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .all<{ id: string }>();
  const role = roleResult.results[0];
  if (role === undefined) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

interface AssemblyState {
  status: string;
  outcome: string | null;
  fileId: string | null;
  fileVersionId: string | null;
  absentFieldKeys: string[];
}

// Drive the consumer against an assembly row written with the engine's own insert statement, NOT
// through the submit route: the route's job coordinator enqueues onto the real queue, whose pool
// delivery consumes with the SUBMITTING member as the actor — a second consumption racing this
// test's own, with a different identity. The audit assertions below are about who a decrypt was
// performed FOR, so the one consumption must be the one this test issues.
async function assembleAs(requestedBy: UserId): Promise<AssemblyState> {
  const assemblyId = newIdentifier("documentAssembly");
  const row = {
    id: assemblyId,
    matterId,
    templateId: templateIdOfVersion,
    templateVersionId,
    folderId: null,
    outputFormat: "docx",
    engineVersion: 1,
    dictionaryVersion: 1,
    requestedBy,
    createdAt: new Date().toISOString(),
  } as Parameters<typeof insertDocumentAssemblyStatement>[1];
  await insertDocumentAssemblyStatement(firmDatabaseFor(env.FIRM_DATABASE, firmId), row).run();
  const message: DocumentAssemblyMessage = {
    firmId,
    bucketName,
    assemblyId,
    matterId,
    templateVersionId,
    folderId: null,
    requestedBy,
  };
  const batch = {
    queue: "magna-carta-production-document-assembly",
    messages: [
      {
        id: `matter-records-${assemblyId}`,
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => undefined,
        retry: () => undefined,
      },
    ],
  } as unknown as MessageBatch<DocumentAssemblyMessage>;
  await documentAssemblyQueue(batch, env);
  const polled = await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, ownerCookie);
  expect(polled.status).toBe(200);
  return jsonOf<AssemblyState>(polled);
}

async function producedDocumentText(state: AssemblyState): Promise<string> {
  const version = await queryFirstRow<{ r2_key: string }>(
    "SELECT r2_key FROM file_version WHERE id = ?1",
    [state.fileVersionId],
  );
  const object = await env.R2.get(version?.r2_key ?? "");
  expect(object).not.toBeNull();
  return new TextDecoder().decode(
    unzipSync(new Uint8Array(await (object as R2ObjectBody).arrayBuffer()))["word/document.xml"] ??
      new Uint8Array(),
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  bucketName = "matter-records-firm-bucket";
  firmId = (await seedFirm({ name: "Matter Records Firm" })).firmId;
  await seedFirmKey(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, bucketName)
    .run();

  const owner = await seedCredentialedUser("matter-records-owner@example.com", {
    userName: "Matter Records Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Matter Records Owner", firmId);
  ownerCookie = await signInForSessionCookie("matter-records-owner@example.com");

  const paralegal = await seedCredentialedUser("matter-records-paralegal@example.com", {
    userName: "Matter Records Paralegal",
    firmId,
  });
  paralegalUserId = paralegal.userId;
  await mirrorMemberWithRole(paralegal.userId, "Matter Records Paralegal", "Paralegal");

  const supervisor = await seedCredentialedUser("matter-records-supervisor@example.com", {
    userName: "Priya Vale",
    firmId,
  });
  supervisorUserId = supervisor.userId;
  await mirrorMemberWithRole(supervisor.userId, "Priya Vale", "Attorney");

  const scheme = await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "MR-" },
      { kind: "counter", padWidth: 4 },
    ],
  });
  expect(scheme.status, await scheme.clone().text()).toBe(200);

  const matter = await post("/api/v1/matters", {
    title: "Estate of Rowan Ashcroft",
    status: "open",
    responsibleMemberId: ownerUserId,
    clientDisplayName: "Devon Marchetti",
  });
  expect(matter.status, await matter.clone().text()).toBe(201);
  matterId = (await jsonOf<{ matterId: string }>(matter)).matterId;

  // The supervising attorney's mapped Directory person, holding the sealed bar number the template
  // will name. The member mapping is the column the staffing read joins through.
  const person = await post("/api/v1/directory/persons", { given: "Priya", family: "Vale" });
  expect(person.status, await person.clone().text()).toBe(201);
  supervisorEntityId = (await jsonOf<{ id: string }>(person)).id;
  await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare("UPDATE directory_person SET member_id = ?2 WHERE id = ?1")
    .bind(supervisorEntityId, supervisorUserId)
    .run();
  const sealed = await post(`/api/v1/directory/entities/${supervisorEntityId}/identifiers`, {
    type: "bar_number",
    label: "Illinois",
    number: SEALED_BAR_NUMBER,
  });
  expect(sealed.status, await sealed.clone().text()).toBe(201);
  identifierRowId =
    (
      await queryFirstRow<{ id: string }>(
        "SELECT id FROM directory_identifier WHERE entity_id = ?1 AND identifier_type = 'bar_number'",
        [supervisorEntityId],
      )
    )?.id ?? "";
  expect(identifierRowId).not.toBe("");
});

describe("matter staffing", () => {
  it("staffs a member, matches the role by letters and digits, and lists the assignment", async () => {
    const created = await post(`/api/v1/matters/${matterId}/assignments`, {
      memberUserId: supervisorUserId,
      assignmentRole: "Supervising Attorney",
    });
    expect(created.status, await created.clone().text()).toBe(201);

    const listed = await get(`/api/v1/matters/${matterId}/assignments`);
    expect(listed.status).toBe(200);
    const { data } = await jsonOf<{ data: { assignmentRole: string; memberUserId: string }[] }>(
      listed,
    );
    expect(data).toHaveLength(1);
    expect(data[0]?.memberUserId).toBe(supervisorUserId);
  });

  it("refuses a role that names the responsible attorney — that fact has one home", async () => {
    const refused = await post(`/api/v1/matters/${matterId}/assignments`, {
      memberUserId: supervisorUserId,
      assignmentRole: "responsible_attorney",
    });
    expect(refused.status).toBe(422);
    const problem = await jsonOf<{ detail: string }>(refused);
    expect(problem.detail).toContain("responsible attorney");
  });

  it("refuses a validity bound that is not a civil date — a free string would silently mis-window", async () => {
    for (const garbage of ["next Tuesday", "2026-08-07T12:00:00.000Z", "08/07/2026"]) {
      const refused = await post(`/api/v1/matters/${matterId}/assignments`, {
        memberUserId: supervisorUserId,
        assignmentRole: "originating_attorney",
        validTo: garbage,
      });
      expect(refused.status, garbage).toBe(422);
    }
  });

  it("refuses a window that ends before it starts, and accepts an ordered civil-date window", async () => {
    const refused = await post(`/api/v1/matters/${matterId}/assignments`, {
      memberUserId: supervisorUserId,
      assignmentRole: "originating_attorney",
      validFrom: "2026-08-08",
      validTo: "2026-08-07",
    });
    expect(refused.status).toBe(422);

    const created = await post(`/api/v1/matters/${matterId}/assignments`, {
      memberUserId: supervisorUserId,
      assignmentRole: "originating_attorney",
      validFrom: "2026-01-15",
      validTo: "2026-08-07",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { id: assignmentId } = await jsonOf<{ id: string }>(created);
    const row = await queryFirstRow<{ valid_from: string | null; valid_to: string | null }>(
      "SELECT valid_from, valid_to FROM matter_assignment WHERE id = ?1",
      [assignmentId],
    );
    expect(row).toEqual({ valid_from: "2026-01-15", valid_to: "2026-08-07" });
  });

  it("ends an assignment by stamping its window closed, keeping the row", async () => {
    const created = await post(`/api/v1/matters/${matterId}/assignments`, {
      memberUserId: paralegalUserId,
      assignmentRole: "assigned_paralegal",
    });
    expect(created.status).toBe(201);
    const { id: assignmentId } = await jsonOf<{ id: string }>(created);

    const ended = await post(`/api/v1/matters/${matterId}/assignments/${assignmentId}/end`, {});
    expect(ended.status, await ended.clone().text()).toBe(200);

    const row = await queryFirstRow<{ valid_to: string | null }>(
      "SELECT valid_to FROM matter_assignment WHERE id = ?1",
      [assignmentId],
    );
    expect(row?.valid_to).not.toBeNull();
  });
});

describe("the court-case and estate records", () => {
  it("round-trips the court-case record through its upsert", async () => {
    const empty = await get(`/api/v1/matters/${matterId}/court-case`);
    expect(await jsonOf<{ courtCase: unknown }>(empty)).toEqual({ courtCase: null });

    const court = await post("/api/v1/directory/organizations", {
      legalName: "Second Judicial District Court",
    });
    expect(court.status, await court.clone().text()).toBe(201);
    const courtEntityId = (await jsonOf<{ id: string }>(court)).id;

    const written = await put(`/api/v1/matters/${matterId}/court-case`, {
      courtEntityId,
      judgeEntityId: null,
      caseNumber: "PR26-00381",
      division: "Probate Division",
      department: "Department 6",
      filedOn: "2026-04-09",
      clientDesignation: "Petitioner",
      opposingDesignation: "Respondent",
    });
    expect(written.status, await written.clone().text()).toBe(200);

    const read = await get(`/api/v1/matters/${matterId}/court-case`);
    const body = await jsonOf<{ courtCase: { caseNumber: string; clientDesignation: string } }>(
      read,
    );
    expect(body.courtCase.caseNumber).toBe("PR26-00381");
    expect(body.courtCase.clientDesignation).toBe("Petitioner");
  });

  it("refuses a court reference that names no live Directory record", async () => {
    const refused = await put(`/api/v1/matters/${matterId}/court-case`, {
      courtEntityId: "directoryOrganization_MISSING000000",
      judgeEntityId: null,
      caseNumber: null,
      division: null,
      department: null,
      filedOn: null,
      clientDesignation: null,
      opposingDesignation: null,
    });
    expect(refused.status).toBe(422);
  });

  it("round-trips the estate record with its stored styles", async () => {
    const written = await put(`/api/v1/matters/${matterId}/estate`, {
      decedentEntityId: null,
      estateEntityId: null,
      dateOfDeath: "2026-01-17",
      estateStyle: "the Estate of Rowan Ashcroft, Deceased",
      shortStyle: "the Ashcroft Estate",
      proceedingType: "intestate",
      lettersIssuedOn: null,
    });
    expect(written.status, await written.clone().text()).toBe(200);

    const read = await get(`/api/v1/matters/${matterId}/estate`);
    const body = await jsonOf<{ estate: { estateStyle: string; proceedingType: string } }>(read);
    expect(body.estate.estateStyle).toBe("the Estate of Rowan Ashcroft, Deceased");
    expect(body.estate.proceedingType).toBe("intestate");
  });
});

describe("the member professional profile", () => {
  it("writes through the administrative door and reads back", async () => {
    const empty = await get(`/api/v1/members/${supervisorUserId}/professional-profile`);
    expect(await jsonOf<{ profile: unknown }>(empty)).toEqual({ profile: null });

    const written = await put(`/api/v1/members/${supervisorUserId}/professional-profile`, {
      title: "Partner",
      admissions: "Nevada, 2014",
      directDial: "(775) 555-0114",
      professionalEmail: "p.vale@matterrecords.example",
      signatureBlock: null,
    });
    expect(written.status, await written.clone().text()).toBe(200);

    const read = await get(`/api/v1/members/${supervisorUserId}/professional-profile`);
    const body = await jsonOf<{ profile: { title: string } }>(read);
    expect(body.profile.title).toBe("Partner");
  });
});

describe("the records as merge fields, end to end", () => {
  beforeAll(async () => {
    // The party the capacity line composes over — the client, linked with a recorded capacity.
    const client = await post("/api/v1/directory/persons", { given: "Devon", family: "Marchetti" });
    expect(client.status).toBe(201);
    const clientEntityId = (await jsonOf<{ id: string }>(client)).id;
    const linked = await post("/api/v1/directory/matter-parties", {
      matterId,
      entityId: clientEntityId,
      role: "client",
      capacity: "Administrator",
    });
    expect(linked.status, await linked.clone().text()).toBe(201);

    const minted = await post("/api/v1/templates/upload", {});
    expect(minted.status).toBe(200);
    const { uploadKey } = await jsonOf<{ uploadKey: string }>(minted);
    await env.R2.put(
      uploadKey,
      templateDocx(
        "Supervisor {{supervisingAttorney.displayName}} ({{supervisingAttorney.title}}), " +
          `Bar No. {{${BAR_NUMBER_KEY}}}. ` +
          "In the Matter of {{estate.style}} before the {{court.name:upper}}, " +
          "Case No. {{case.number}}, {{case.clientDesignation}}: {{client.capacityLine}}.",
      ) as unknown as ArrayBuffer,
    );
    const registered = await post("/api/v1/templates", {
      uploadKey,
      name: "Probate Appearance",
    });
    expect(registered.status, await registered.clone().text()).toBe(201);
    templateVersionId = (await jsonOf<{ versionId: string }>(registered)).versionId;
    templateIdOfVersion =
      (
        await queryFirstRow<{ template_id: string }>(
          "SELECT template_id FROM document_template_version WHERE id = ?1",
          [templateVersionId],
        )
      )?.template_id ?? "";
    expect(templateIdOfVersion).not.toBe("");
  });

  it("fills every record's facts, decrypts the bar number, and commits the chokepoint's audit row", async () => {
    const before = await decryptAuditCount(identifierRowId);
    const state = await assembleAs(ownerUserId);
    expect(state.status).toBe("done");
    const text = await producedDocumentText(state);
    expect(text).toContain("Supervisor Priya Vale (Partner)");
    expect(text).toContain(`Bar No. ${SEALED_BAR_NUMBER}`);
    expect(text).toContain("In the Matter of the Estate of Rowan Ashcroft, Deceased");
    expect(text).toContain("before the SECOND JUDICIAL DISTRICT COURT");
    expect(text).toContain("Case No. PR26-00381");
    expect(text).toContain(
      "Petitioner: Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased.",
    );
    expect(await decryptAuditCount(identifierRowId)).toBe(before + 1);
  });

  it("refuses the bar number for a member without the permission — marker, reason, no audit row", async () => {
    const before = await decryptAuditCount(identifierRowId);
    const state = await assembleAs(paralegalUserId);
    expect(state.status).toBe("done");
    expect(state.absentFieldKeys).toContain(BAR_NUMBER_KEY);
    const text = await producedDocumentText(state);
    expect(text).not.toContain(SEALED_BAR_NUMBER);
    expect(text).toContain("BAR NUMBER]");
    // A refused read is not a read: the chokepoint throws before the audit row, so nothing recorded
    // a decrypt that never happened.
    expect(await decryptAuditCount(identifierRowId)).toBe(before);
  });

  it("attempts no decrypt at all for an ambiguous staffing slot", async () => {
    // A second supervising attorney makes the slot ambiguous: the subject resolves to nothing, so
    // the protected facet is an absence BEFORE any decryption — and the audit log shows no decrypt,
    // even for the owner who holds the permission.
    const second = await post(`/api/v1/matters/${matterId}/assignments`, {
      memberUserId: ownerUserId,
      assignmentRole: "supervising-attorney",
    });
    expect(second.status).toBe(201);

    const before = await decryptAuditCount(identifierRowId);
    const state = await assembleAs(ownerUserId);
    expect(state.status).toBe("done");
    expect(state.absentFieldKeys).toContain(BAR_NUMBER_KEY);
    expect(state.absentFieldKeys).toContain("supervisingAttorney.displayName");
    expect(await decryptAuditCount(identifierRowId)).toBe(before);
    const text = await producedDocumentText(state);
    expect(text).not.toContain(SEALED_BAR_NUMBER);
  });
});
