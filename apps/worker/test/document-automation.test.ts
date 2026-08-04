import { env, SELF } from "cloudflare:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { documentAssemblyQueue } from "../src/assemblies/assembly-consumer.ts";
import type { DocumentAssemblyMessage } from "../src/assemblies/assembly-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The document-automation surface end to end under Miniflare: register a template, assemble it against
// a matter, and confirm the produced document reached the matter's File Manager THROUGH THE INGEST
// CHOKEPOINT — a pending file_version and an open-then-completed upload session, never a row written
// straight to `clean`.

// TWO firms, because the rate-limit bucket is keyed by firm and the registration and assembly blocks
// each make close to a bucket's worth of `expensive` calls. Splitting them also keeps each block's
// catalogue state independent, which is what makes the list assertions readable.
let firmId: FirmId;
let ownerCookie: string;

let assemblyFirmId: FirmId;
let assemblyCookie: string;
let assemblyUserId: string;
let matterId: string;
let assemblyBucketName: string;

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_NAMESPACE = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const MAIN_DOCUMENT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

function paragraph(...fragments: readonly string[]): string {
  return `<w:p>${fragments.map((fragment) => `<w:r><w:t xml:space="preserve">${fragment}</w:t></w:r>`).join("")}</w:p>`;
}

interface TemplateOverrides {
  readonly body?: string;
  readonly contentTypes?: string;
  readonly documentRels?: string;
  readonly extra?: Record<string, Uint8Array>;
}

// A template built here rather than committed as a binary, so a reviewer can see exactly which awkward
// shape each case is about — here, a placeholder Word split across four runs.
function templateDocx(overrides: TemplateOverrides = {}): Uint8Array {
  const body =
    overrides.body ?? paragraph("Matter ", "{{matter.", "number}} for ", "{{client.displayName}}");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      overrides.contentTypes ??
        `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${MAIN_DOCUMENT_CONTENT_TYPE}"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      overrides.documentRels ??
        `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    ),
    "word/document.xml": strToU8(
      `${DECLARATION}<w:document ${WORD_NAMESPACE}><w:body>${body}</w:body></w:document>`,
    ),
    "docProps/core.xml": strToU8(
      `${DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Template Author</dc:creator></cp:coreProperties>`,
    ),
    "docProps/app.xml": strToU8(
      `${DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Example Firm</Company></Properties>`,
    ),
  };
  for (const [name, content] of Object.entries(overrides.extra ?? {})) files[name] = content;
  return zipSync(files);
}

// The complex field construct Word writes for an inserted merge field.
function mergeFieldParagraph(fieldName: string): string {
  return (
    "<w:p>" +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> MERGEFIELD  ${fieldName}  \\* MERGEFORMAT </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:t>«${fieldName}»</w:t></w:r>` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    "</w:p>"
  );
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

// Stage a template upload: mint the slot through the route, then write the bytes where the presign
// pointed. (Miniflare delivers no presigned PUT, so the object is written directly to the bound bucket
// — the same object the registration route reads back.)
async function stageUpload(bytes: Uint8Array, cookie = ownerCookie): Promise<string> {
  const minted = await post("/api/v1/templates/upload", {}, cookie);
  expect(minted.status).toBe(200);
  const { uploadKey } = (await minted.json()) as { uploadKey: string };
  await env.R2.put(uploadKey, bytes as unknown as ArrayBuffer);
  return uploadKey;
}

interface RegisteredTemplateBody {
  templateId: string;
  versionId: string;
  versionNumber: number;
  status: string;
  fieldCount: number;
  macroPartsRemoved: number;
  mergeFieldsConverted: boolean;
  mergeFieldsDetected: { fieldName: string; mappedKey: string; mapsToKnownField: boolean }[];
}

async function registerTemplate(
  bytes: Uint8Array,
  name: string,
  extra: Record<string, unknown> = {},
  cookie = ownerCookie,
): Promise<Response> {
  const uploadKey = await stageUpload(bytes, cookie);
  return post("/api/v1/templates", { uploadKey, name, ...extra }, cookie);
}

function makeBatch(message: DocumentAssemblyMessage): {
  batch: MessageBatch<DocumentAssemblyMessage>;
  acks: string[];
  retries: string[];
} {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-document-assembly",
    messages: [
      {
        id: "assembly-msg",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push("assembly-msg"),
        retry: () => retries.push("assembly-msg"),
      },
    ],
  } as unknown as MessageBatch<DocumentAssemblyMessage>;
  return { batch, acks, retries };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);

  firmId = (await seedFirm({ name: "Document Automation Firm" })).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, "document-automation-firm-bucket")
    .run();
  const owner = await seedCredentialedUser("automation-owner@example.com", {
    userName: "Automation Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Automation Owner", firmId);
  ownerCookie = await signInForSessionCookie("automation-owner@example.com");

  assemblyBucketName = "document-automation-assembly-bucket";
  assemblyFirmId = (await seedFirm({ name: "Document Assembly Firm" })).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(assemblyFirmId, assemblyBucketName)
    .run();
  const assemblyOwner = await seedCredentialedUser("assembly-owner@example.com", {
    userName: "Assembly Owner",
    firmId: assemblyFirmId,
  });
  assemblyUserId = assemblyOwner.userId;
  await mirrorMemberWithOwnerRole(assemblyOwner.userId, "Assembly Owner", assemblyFirmId);
  assemblyCookie = await signInForSessionCookie("assembly-owner@example.com");

  // A matter number is drawn from the firm's active numbering scheme, so an open matter needs one.
  const scheme = await put(
    "/api/v1/numbering-scheme",
    {
      segments: [
        { kind: "literal", text: "DA-" },
        { kind: "counter", padWidth: 4 },
      ],
    },
    assemblyCookie,
  );
  expect(scheme.status, await scheme.clone().text()).toBe(200);

  const created = await post(
    "/api/v1/matters",
    {
      title: "Riverside Contract Dispute",
      status: "open",
      responsibleMemberId: assemblyUserId,
      clientDisplayName: "Acme Holdings LLC",
    },
    assemblyCookie,
  );
  expect(created.status, await created.clone().text()).toBe(201);
  matterId = ((await created.json()) as { matterId: string }).matterId;
});

describe("the merge-field dictionary", () => {
  it("lists the fields a template may be authored against, with the renderings each supports", async () => {
    const response = await get("/api/v1/merge-fields");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      fields: { key: string; source: string; formats: string[]; absence: string }[];
    };
    const byKey = new Map(body.fields.map((field) => [field.key, field]));
    expect(byKey.get("matter.number")).toMatchObject({ source: "matter", absence: "fail" });
    expect(byKey.get("matter.openedOn")?.formats).toContain("legal");
  });

  it("is not reachable without a session", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/merge-fields", {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
  });
});

describe("template registration", () => {
  it("registers a template whose placeholders Word split across runs, and reports its fields", async () => {
    const response = await registerTemplate(templateDocx(), "Engagement Letter");
    expect(response.status).toBe(201);
    const body = (await response.json()) as RegisteredTemplateBody;
    expect(body.status).toBe("clean");
    expect(body.fieldCount).toBe(2);
    expect(body.macroPartsRemoved).toBe(0);
    expect(body.mergeFieldsDetected).toEqual([]);

    const fields = await get(
      `/api/v1/templates/${body.templateId}/versions/${body.versionId}/fields`,
    );
    expect(fields.status).toBe(200);
    const manifest = (await fields.json()) as {
      fields: { key: string; source: string; absence: string }[];
    };
    expect(manifest.fields.map((field) => field.key).sort()).toEqual([
      "client.displayName",
      "matter.number",
    ]);
    // The manifest is resolved against the dictionary, so the field inspector can say what each field
    // reads from and what happens when the matter has no value for it.
    expect(manifest.fields.every((field) => field.source !== null)).toBe(true);
  });

  it("lists the registered template in the catalogue", async () => {
    const response = await get("/api/v1/templates");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { templateId: string; name: string; currentVersionId: string | null }[];
      nextCursor: string | null;
    };
    const entry = body.data.find((item) => item.name === "Engagement Letter");
    expect(entry).toBeDefined();
    // The catalogue's current version moved once the version's bytes cleared the scan.
    expect(entry?.currentVersionId).not.toBeNull();
  });

  it("refuses a placeholder that names no merge field, pointing at the part and the key", async () => {
    const response = await registerTemplate(
      templateDocx({ body: paragraph("Matter {{matter.numbre}}") }),
      "Typo Template",
    );
    expect(response.status).toBe(422);
    const problem = (await response.json()) as {
      type: string;
      errors?: { path: string; code: string; detail: string }[];
    };
    expect(problem.type).toContain("template-normalization-failed");
    expect(problem.errors?.[0]).toMatchObject({
      path: "word/document.xml",
      code: "unknown-key",
    });
    expect(problem.errors?.[0]?.detail).toContain("matter.numbre");
  });

  it("REFUSES a Word merge-field template by default, and reports every field it found", async () => {
    // Conversion is opt-in: the firm's own uploaded document is never rewritten unasked, and the
    // refusal carries the list so a caller can present the choice rather than a dead end.
    const response = await registerTemplate(
      templateDocx({ body: mergeFieldParagraph("matter.number") }),
      "Mail Merge Letter",
    );
    expect(response.status).toBe(422);
    const problem = (await response.json()) as {
      errors?: { path: string; code: string; detail: string }[];
    };
    const codes = (problem.errors ?? []).map((error) => error.code);
    expect(codes).toContain("merge-field-conversion-required");
    expect(codes).toContain("word-merge-field");
    expect(problem.errors?.find((error) => error.code === "word-merge-field")?.detail).toContain(
      "matter.number",
    );
  });

  it("converts Word merge fields when the caller opts in, and says that it did", async () => {
    const response = await registerTemplate(
      templateDocx({ body: mergeFieldParagraph("matter.number") }),
      "Mail Merge Letter Converted",
      { convertMergeFields: true },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as RegisteredTemplateBody;
    expect(body.mergeFieldsConverted).toBe(true);
    expect(body.mergeFieldsDetected).toEqual([
      expect.objectContaining({
        fieldName: "matter.number",
        mappedKey: "matter.number",
        mapsToKnownField: true,
      }),
    ]);
    expect(body.fieldCount).toBe(1);
  });

  it("ACCEPTS a macro-bearing template, strips the macro project, and reports that it did", async () => {
    const response = await registerTemplate(
      templateDocx({
        contentTypes:
          `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>' +
          "</Types>",
        documentRels:
          `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          '<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>' +
          "</Relationships>",
        extra: { "word/vbaProject.bin": strToU8("stand-in vbaProject payload") },
      }),
      "Macro Letter",
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as RegisteredTemplateBody;
    expect(body.macroPartsRemoved).toBe(1);
    expect(body.status).toBe("clean");
  });

  it("refuses an upload key that does not belong to the session firm", async () => {
    const response = await post("/api/v1/templates", {
      uploadKey: "templates/staging/firm_someoneelse/version",
      name: "Borrowed Upload",
    });
    expect(response.status).toBe(422);
  });

  it("is refused without a session", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/templates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ uploadKey: "x", name: "y" }),
    });
    expect(response.status).toBe(401);
  });

  it("requires an Idempotency-Key", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/templates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
      },
      body: JSON.stringify({ uploadKey: "x", name: "y" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("assembly, end to end through the ingest chokepoint", () => {
  it("assembles a template onto a matter and files the result as a scanned document", async () => {
    const registered = (await (
      await registerTemplate(templateDocx(), "Assembly Letter", {}, assemblyCookie)
    ).json()) as RegisteredTemplateBody;

    const submitted = await post(
      `/api/v1/matters/${matterId}/assemblies`,
      { templateVersionId: registered.versionId },
      assemblyCookie,
    );
    expect(submitted.status).toBe(202);
    const { assemblyId } = (await submitted.json()) as { assemblyId: string };

    const queued = await get(
      `/api/v1/matters/${matterId}/assemblies/${assemblyId}`,
      assemblyCookie,
    );
    expect(((await queued.json()) as { status: string }).status).toBe("queued");

    const { batch, acks } = makeBatch({
      firmId: assemblyFirmId,
      bucketName: assemblyBucketName,
      assemblyId,
      matterId,
      templateVersionId: registered.versionId,
      folderId: null,
      requestedBy: assemblyUserId,
    });
    await documentAssemblyQueue(batch, env);
    expect(acks).toHaveLength(1);

    const polled = await get(
      `/api/v1/matters/${matterId}/assemblies/${assemblyId}`,
      assemblyCookie,
    );
    expect(polled.status).toBe(200);
    const state = (await polled.json()) as {
      status: string;
      outcome: string | null;
      fileId: string | null;
      fileVersionId: string | null;
      absentFieldKeys: string[];
    };
    expect(state.status).toBe("done");
    expect(state.fileId).not.toBeNull();
    expect(state.fileVersionId).not.toBeNull();
    // The matter supplies both fields, so nothing is absent.
    expect(state.absentFieldKeys).toEqual([]);
    expect(state.outcome).toBe("succeeded");

    // THE CHOKEPOINT ASSERTION. The produced version was staged `pending` through initiateUpload and
    // its upload session was completed — it did NOT appear as a `clean` row written directly by the
    // assembly consumer. A second path to `clean` is exactly what this design refuses.
    const version = await queryFirstRow<{ status: string; r2_key: string }>(
      "SELECT status, r2_key FROM file_version WHERE id = ?1",
      [state.fileVersionId],
    );
    expect(version?.status).toBe("pending");
    expect(version?.r2_key).toContain("files/");
    const session = await queryFirstRow<{ status: string }>(
      "SELECT status FROM upload_session WHERE file_version_id = ?1",
      [state.fileVersionId],
    );
    expect(session?.status).toBe("completed");

    // The merged bytes really are in the firm's bucket under the version's key, and they really carry
    // the substituted values rather than the placeholders.
    const object = await env.R2.get(version?.r2_key ?? "");
    expect(object).not.toBeNull();
    const produced = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());
    const documentText = new TextDecoder().decode(readZipEntry(produced, "word/document.xml"));
    expect(documentText).toContain("Acme Holdings LLC");
    expect(documentText).not.toContain("{{");
  });

  it("files exactly one document when the same queue message is redelivered", async () => {
    const registered = (await (
      await registerTemplate(templateDocx(), "Redelivery Letter", {}, assemblyCookie)
    ).json()) as RegisteredTemplateBody;
    const submitted = await post(
      `/api/v1/matters/${matterId}/assemblies`,
      { templateVersionId: registered.versionId },
      assemblyCookie,
    );
    const { assemblyId } = (await submitted.json()) as { assemblyId: string };
    const message: DocumentAssemblyMessage = {
      firmId: assemblyFirmId,
      bucketName: assemblyBucketName,
      assemblyId,
      matterId,
      templateVersionId: registered.versionId,
      folderId: null,
      requestedBy: assemblyUserId,
    };

    await documentAssemblyQueue(makeBatch(message).batch, env);
    const first = (await (
      await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, assemblyCookie)
    ).json()) as { fileId: string };

    // The redelivery: the row already records a filed document, so the consumer short-circuits.
    await documentAssemblyQueue(makeBatch(message).batch, env);
    const second = (await (
      await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, assemblyCookie)
    ).json()) as { fileId: string };

    expect(second.fileId).toBe(first.fileId);
    const count = await queryFirstRow<{ n: number }>(
      "SELECT COUNT(*) AS n FROM document_assembly WHERE id = ?1 AND status = 'done'",
      [assemblyId],
    );
    expect(count?.n).toBe(1);
  });

  it("records the absent keys, and only the keys, when the matter cannot supply a field", async () => {
    // location.* resolves from the matter's home location; this matter has none, so those fields are
    // absences the assembly reports rather than blanks nobody notices.
    const registered = (await (
      await registerTemplate(
        templateDocx({ body: paragraph("{{matter.number}} — {{location.remitTo}}") }),
        "Remit Letter",
        {},
        assemblyCookie,
      )
    ).json()) as RegisteredTemplateBody;
    const submitted = await post(
      `/api/v1/matters/${matterId}/assemblies`,
      { templateVersionId: registered.versionId },
      assemblyCookie,
    );
    const { assemblyId } = (await submitted.json()) as { assemblyId: string };
    await documentAssemblyQueue(
      makeBatch({
        firmId: assemblyFirmId,
        bucketName: assemblyBucketName,
        assemblyId,
        matterId,
        templateVersionId: registered.versionId,
        folderId: null,
        requestedBy: assemblyUserId,
      }).batch,
      env,
    );

    const state = (await (
      await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, assemblyCookie)
    ).json()) as { status: string; outcome: string; absentFieldKeys: string[] };
    expect(state.status).toBe("done");
    expect(state.outcome).toBe("succeeded_with_absences");
    expect(state.absentFieldKeys).toEqual(["location.remitTo"]);

    // The stored provenance row holds the KEY and nothing about any value that did resolve.
    const row = await queryFirstRow<{ absent_field_keys_json: string }>(
      "SELECT absent_field_keys_json FROM document_assembly WHERE id = ?1",
      [assemblyId],
    );
    expect(JSON.parse(row?.absent_field_keys_json ?? "[]")).toEqual(["location.remitTo"]);
    expect(row?.absent_field_keys_json).not.toContain("Acme");
  });

  it("refuses a submit against an archived template", async () => {
    const registered = (await (
      await registerTemplate(templateDocx(), "Archived Letter", {}, assemblyCookie)
    ).json()) as RegisteredTemplateBody;
    const archived = await post(
      `/api/v1/templates/${registered.templateId}/archive`,
      {},
      assemblyCookie,
    );
    expect(archived.status).toBe(200);

    const submitted = await post(
      `/api/v1/matters/${matterId}/assemblies`,
      { templateVersionId: registered.versionId },
      assemblyCookie,
    );
    expect(submitted.status).toBe(422);
    expect(((await submitted.json()) as { type: string }).type).toContain(
      "template-not-activatable",
    );
  });

  it("404s a submit against a template version that does not exist", async () => {
    const submitted = await post(
      `/api/v1/matters/${matterId}/assemblies`,
      { templateVersionId: `documentTemplateVersion_${"0".repeat(21)}` },
      assemblyCookie,
    );
    expect(submitted.status).toBe(404);
  });

  it("is refused without a session", async () => {
    const response = await SELF.fetch(`https://example.com/api/v1/matters/${matterId}/assemblies`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ templateVersionId: "documentTemplateVersion_x" }),
    });
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function queryFirstRow<T>(sql: string, bindings: unknown[]): Promise<T | undefined> {
  const { firmDatabaseFor } = await import("../src/firm-database/firm-database-proxy.ts");
  const database = firmDatabaseFor(env.FIRM_DATABASE, assemblyFirmId);
  const { results } = await database
    .prepare(sql)
    .bind(...bindings)
    .all<T>();
  return results[0];
}

function readZipEntry(bytes: Uint8Array, name: string): Uint8Array {
  // The produced document is a small package; inflating it whole in a test is fine.
  return unzipSync(bytes)[name] ?? new Uint8Array();
}
