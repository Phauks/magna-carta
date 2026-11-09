import { env, SELF } from "cloudflare:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { insertDocumentAssemblyStatement } from "@magna-carta/document-assembly/assembly-statements";
import { DICTIONARY_VERSION } from "@magna-carta/document-assembly/resolve";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { documentAssemblyQueue } from "../src/background/assemblies/assembly-consumer.ts";
import { ASSEMBLY_ENGINE_VERSION } from "../src/assemblies/assembly-engine.ts";
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

// A merge field bound to a sealed value, assembled for real: the same firm key, the same protected-field
// chokepoint, the same audit table a direct decrypt writes to.
//
// Four things are proven here and can only be proven here, because each is a property of the REAL
// decrypt path rather than of a fake standing in for it:
//   - a member who holds the permission gets the value AND the assembly commits the same decrypt-audit
//     row a direct read commits — same event name, same subject, same table;
//   - a member who does not gets a document with a marked gap, a reason naming the permission, NO audit
//     row recording a decrypt that never happened, and the value in nothing the API hands back;
//   - the plaintext reaches no stored row — not the assembly's provenance row, not the audit metadata;
//   - the plaintext reaches no emitted log line or metric.
//
// A paralegal is the case that matters, not a contrivance: `documents:assemble` is seeded to Owner,
// Attorney, and Paralegal, and `directory:viewSensitiveIdentifiers` to Owner alone. The member who most
// often assembles a retainer is exactly the member who may not read the tax identifier in it.

const SEALED_SOCIAL_SECURITY_NUMBER = "987-65-4321";
const PROTECTED_KEY = "client.socialSecurityNumber";
const ABSENCE_MARKER = "[CLIENT&apos;S SOCIAL SECURITY NUMBER]";

let firmId: FirmId;
let bucketName: string;
let ownerCookie: string;
let ownerUserId: UserId;
let paralegalUserId: UserId;
let matterId: string;
let clientEntityId: string;
let identifierRowId: string;
let templateVersionId: string;

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

// The decrypt-audit rows a subject has accumulated — the same query the directory's own audited-read
// test uses, because it is the same row written by the same chokepoint.
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

// The assembly row is SEEDED, not submitted through the route. The submit route is not what this
// file proves — document-automation.test.ts owns it — and under the test pool a route submit also
// starts the coordinator, whose real queue message the live document-assembly consumer then
// processes about a second later, concurrently with the direct documentAssemblyQueue call below.
// Whichever consume wins the race files the document, and when the delivery wins it decrypts as the
// SUBMITTING owner — moving the decrypt-audit counts these tests exist to pin down, and putting the
// value into a document a test expects to carry an absence. Production never has two competing
// consumes for one assembly (the coordinator single-flights the enqueue); seeding the row keeps the
// one consume under test — the real consumer, the real chokepoint, the real audit write — without
// manufacturing a second. The row's requested_by is the owner, exactly as the route records the
// submitter; the MESSAGE carries the identity the job runs for, which is the fact under test.
async function seedAssembly(): Promise<string> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const assemblyId = newIdentifier("documentAssembly");
  const templateId =
    (
      await queryFirstRow<{ template_id: string }>(
        "SELECT template_id FROM document_template_version WHERE id = ?1",
        [templateVersionId],
      )
    )?.template_id ?? "";
  expect(templateId).not.toBe("");
  await insertDocumentAssemblyStatement(firmDatabase, {
    id: assemblyId,
    matterId: assertIdentifier(matterId, "matter"),
    templateId: assertIdentifier(templateId, "documentTemplate"),
    templateVersionId: assertIdentifier(templateVersionId, "documentTemplateVersion"),
    folderId: null,
    outputFormat: "docx",
    engineVersion: ASSEMBLY_ENGINE_VERSION,
    dictionaryVersion: DICTIONARY_VERSION,
    requestedBy: ownerUserId,
    createdAt: new Date().toISOString(),
  }).run();
  return assemblyId;
}

function messageFor(assemblyId: string, requestedBy: string | null): DocumentAssemblyMessage {
  return {
    firmId,
    bucketName,
    assemblyId,
    matterId,
    templateVersionId,
    folderId: null,
    requestedBy,
  };
}

function batchFor(message: DocumentAssemblyMessage) {
  return {
    queue: "magna-carta-production-document-assembly",
    messages: [
      {
        id: "protected-assembly-msg",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => undefined,
        retry: () => undefined,
      },
    ],
  } as unknown as MessageBatch<DocumentAssemblyMessage>;
}

interface AssemblyState {
  status: string;
  outcome: string | null;
  fileId: string | null;
  fileVersionId: string | null;
  absentFieldKeys: string[];
}

// Seed the assembly as the owner would have submitted it and consume the job as `requestedBy`. The
// consumer resolves what that member may decrypt from the firm's database at consume time, which is
// the whole point: the message carries an identity, never a decided answer.
async function assembleAs(requestedBy: UserId): Promise<{ state: AssemblyState; lines: string[] }> {
  const assemblyId = await seedAssembly();

  // The telemetry adapter is the one sanctioned console site, so capturing console is capturing every
  // structured line and every metric this job emits.
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await documentAssemblyQueue(batchFor(messageFor(assemblyId, requestedBy)), env);
  } finally {
    logSpy.mockRestore();
  }

  const polled = await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, ownerCookie);
  expect(polled.status).toBe(200);
  return { state: await jsonOf<AssemblyState>(polled), lines };
}

function documentTextOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(bytes)["word/document.xml"] ?? new Uint8Array());
}

async function producedDocumentText(state: AssemblyState): Promise<string> {
  const version = await queryFirstRow<{ r2_key: string }>(
    "SELECT r2_key FROM file_version WHERE id = ?1",
    [state.fileVersionId],
  );
  const object = await env.R2.get(version?.r2_key ?? "");
  expect(object).not.toBeNull();
  return documentTextOf(new Uint8Array(await (object as R2ObjectBody).arrayBuffer()));
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  bucketName = "protected-binding-firm-bucket";
  firmId = (await seedFirm({ name: "Protected Binding Firm" })).firmId;
  await seedFirmKey(firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, bucketName)
    .run();

  const owner = await seedCredentialedUser("protected-binding-owner@example.com", {
    userName: "Protected Binding Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Protected Binding Owner", firmId);
  ownerCookie = await signInForSessionCookie("protected-binding-owner@example.com");

  const paralegal = await seedCredentialedUser("protected-binding-paralegal@example.com", {
    userName: "Protected Binding Paralegal",
    firmId,
  });
  paralegalUserId = paralegal.userId;
  await mirrorMemberWithRole(paralegal.userId, "Protected Binding Paralegal", "Paralegal");

  // The matter, its client as a real Directory person, and the person's sealed identifier — written
  // through the ordinary routes, so the ciphertext in the column is the one the chokepoint produced.
  const scheme = await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "PB-" },
      { kind: "counter", padWidth: 4 },
    ],
  });
  expect(scheme.status, await scheme.clone().text()).toBe(200);

  const matter = await post("/api/v1/matters", {
    title: "Engagement — Marguerite Ashdown",
    status: "open",
    responsibleMemberId: ownerUserId,
    clientDisplayName: "Marguerite Ashdown",
  });
  expect(matter.status, await matter.clone().text()).toBe(201);
  matterId = (await jsonOf<{ matterId: string }>(matter)).matterId;

  const person = await post("/api/v1/directory/persons", {
    given: "Marguerite",
    family: "Ashdown",
  });
  expect(person.status, await person.clone().text()).toBe(201);
  clientEntityId = (await jsonOf<{ id: string }>(person)).id;

  const linked = await post("/api/v1/directory/matter-parties", {
    matterId,
    entityId: clientEntityId,
    role: "client",
  });
  expect(linked.status, await linked.clone().text()).toBe(201);

  const sealed = await post(`/api/v1/directory/entities/${clientEntityId}/identifiers`, {
    type: "ssn",
    number: SEALED_SOCIAL_SECURITY_NUMBER,
  });
  expect(sealed.status, await sealed.clone().text()).toBe(201);
  identifierRowId =
    (
      await queryFirstRow<{ id: string }>(
        "SELECT id FROM directory_identifier WHERE entity_id = ?1 AND identifier_type = 'ssn'",
        [clientEntityId],
      )
    )?.id ?? "";
  expect(identifierRowId).not.toBe("");

  const uploadKey = await (async () => {
    const minted = await post("/api/v1/templates/upload", {});
    expect(minted.status).toBe(200);
    const { uploadKey: key } = await jsonOf<{ uploadKey: string }>(minted);
    await env.R2.put(
      key,
      templateDocx(
        `Client {{client.displayName}} — identifier {{${PROTECTED_KEY}}}`,
      ) as unknown as ArrayBuffer,
    );
    return key;
  })();
  const registered = await post("/api/v1/templates", {
    uploadKey,
    name: "Engagement Letter With Identifier",
  });
  expect(registered.status, await registered.clone().text()).toBe(201);
  templateVersionId = (await jsonOf<{ versionId: string }>(registered)).versionId;
});

describe("registering a template that binds a protected field", () => {
  it("is allowed, and the field list marks the field protected", async () => {
    const templateId = (
      await queryFirstRow<{ template_id: string }>(
        "SELECT template_id FROM document_template_version WHERE id = ?1",
        [templateVersionId],
      )
    )?.template_id;
    const response = await get(
      `/api/v1/templates/${templateId}/versions/${templateVersionId}/fields`,
    );
    expect(response.status).toBe(200);
    const body = await jsonOf<{
      fields: { key: string; sensitivity: string | null }[];
    }>(response);
    const field = body.fields.find((one) => one.key === PROTECTED_KEY);
    // Binding names a KEY, not a value: registration decrypts nothing, so it needs no decrypt
    // permission — but the surface an author picks from has to say what they have just bound.
    expect(field?.sensitivity).toBe("protected");
    expect(body.fields.find((one) => one.key === "client.displayName")?.sensitivity).toBe(
      "ordinary",
    );
  });

  it("marks the field protected in the dictionary a template is authored against", async () => {
    const response = await get("/api/v1/merge-fields");
    expect(response.status).toBe(200);
    const body = await jsonOf<{ fields: { key: string; sensitivity: string }[] }>(response);
    expect(body.fields.find((one) => one.key === PROTECTED_KEY)?.sensitivity).toBe("protected");
  });
});

describe("assembling for a member who holds the decrypt permission", () => {
  it("fills the value in and commits the same decrypt-audit row a direct read commits", async () => {
    const before = await decryptAuditCount(identifierRowId);
    const { state } = await assembleAs(ownerUserId);

    expect(state.status).toBe("done");
    expect(state.absentFieldKeys).not.toContain(PROTECTED_KEY);
    expect(await producedDocumentText(state)).toContain(SEALED_SOCIAL_SECURITY_NUMBER);

    // ONE audit row, the chokepoint's own: same event, same subject (the identifier row the AAD binds
    // the ciphertext to), same table. Assembly did not invent a second shape for recording a decrypt.
    expect(await decryptAuditCount(identifierRowId)).toBe(before + 1);
    const audited = await queryFirstRow<{
      event: string;
      actor_user_id: string | null;
      metadata: string | null;
    }>(
      "SELECT event, actor_user_id, metadata FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [identifierRowId],
    );
    expect(audited?.event).toBe("protected.decrypt");
    // The member the assembly ran for is the actor on the record — a decrypt is attributed to whoever
    // it was performed for, not to the job that performed it.
    expect(audited?.actor_user_id).toBe(ownerUserId);
    // Identity of the field only. A decrypt record that carried what was decrypted would be a plaintext
    // copy of the column in a table nobody encrypts.
    expect(audited?.metadata ?? "").not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
  });

  it("keeps the value out of every row the assembly writes", async () => {
    const { state } = await assembleAs(ownerUserId);
    const assemblyRow = await queryFirstRow<Record<string, unknown>>(
      "SELECT * FROM document_assembly WHERE id = (SELECT id FROM document_assembly ORDER BY created_at DESC, id DESC LIMIT 1)",
      [],
    );
    expect(JSON.stringify(assemblyRow)).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);

    const fileRow = await queryFirstRow<Record<string, unknown>>(
      "SELECT * FROM file_version WHERE id = ?1",
      [state.fileVersionId],
    );
    // The bytes in the object store carry the value; the ROW that points at them records a name, a
    // size, and a hash. A merge value is never persisted, and the produced document is not the merge
    // value — it is the firm's own document, filed like any other.
    expect(JSON.stringify(fileRow)).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);

    const auditRows = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare("SELECT event, subject_id, metadata FROM audit_log")
      .all();
    expect(JSON.stringify(auditRows.results)).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
  });

  it("emits no log line and no metric carrying the value", async () => {
    const { lines } = await assembleAs(ownerUserId);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
  });
});

describe("assembling for a member who does not hold the decrypt permission", () => {
  it("produces the document with a declared absence, no value, and no audit row", async () => {
    const before = await decryptAuditCount(identifierRowId);
    const { state, lines } = await assembleAs(paralegalUserId);

    // The assembly COMPLETES. One field nobody may read is not a reason to withhold a document.
    expect(state.status).toBe("done");
    expect(state.outcome).toBe("succeeded_with_absences");
    expect(state.absentFieldKeys).toContain(PROTECTED_KEY);

    const text = await producedDocumentText(state);
    expect(text).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
    // A marked gap, not a blank: whoever reads the draft can see something is missing.
    expect(text).toContain(ABSENCE_MARKER);
    // The rest of the document is unaffected — an ordinary field beside a refused one still resolves.
    expect(text).toContain("Marguerite Ashdown");

    // A REFUSED READ IS NOT A READ. The chokepoint refuses before any decrypt and before any audit
    // write, and assembly adds no record of its own.
    expect(await decryptAuditCount(identifierRowId)).toBe(before);
    for (const line of lines) expect(line).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
  });

  it("hands back nothing that carries the value, on any response the member can read", async () => {
    const { state } = await assembleAs(paralegalUserId);
    expect(JSON.stringify(state)).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);

    // The field list for the version that was assembled — the surface that says the field is protected
    // — and the dictionary behind it. Both describe the field; neither carries what it holds.
    const templateId = (
      await queryFirstRow<{ template_id: string }>(
        "SELECT template_id FROM document_template_version WHERE id = ?1",
        [templateVersionId],
      )
    )?.template_id;
    const fields = await get(
      `/api/v1/templates/${templateId}/versions/${templateVersionId}/fields`,
      ownerCookie,
    );
    expect(fields.status).toBe(200);
    expect(await fields.text()).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
    const catalogue = await get("/api/v1/merge-fields", ownerCookie);
    expect(await catalogue.text()).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
  });
});

describe("assembling with no requesting member", () => {
  it("decrypts nothing, and the field is an absence", async () => {
    const before = await decryptAuditCount(identifierRowId);
    const assemblyId = await seedAssembly();
    await documentAssemblyQueue(batchFor(messageFor(assemblyId, null)), env);

    const state = await jsonOf<AssemblyState>(
      await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, ownerCookie),
    );
    expect(state.status).toBe("done");
    expect(state.absentFieldKeys).toContain(PROTECTED_KEY);
    expect(await producedDocumentText(state)).not.toContain(SEALED_SOCIAL_SECURITY_NUMBER);
    // Nobody to gate is not the same as nobody to stop: there is no principal, so there is no decrypt.
    expect(await decryptAuditCount(identifierRowId)).toBe(before);
  });
});
