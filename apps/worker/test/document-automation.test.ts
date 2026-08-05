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

// SEVERAL firms, because the rate-limit bucket is keyed by firm and each block here makes close to a
// bucket's worth of `expensive` calls (a registration and a submit are both expensive). Splitting them
// also keeps each block's catalogue and mapping-library state independent, which is what makes the
// list assertions readable — a shared firm would make every assertion depend on the block above it.
let ownerCookie: string;

let mappingCookie: string;

let assemblyFirmId: FirmId;
let assemblyCookie: string;
let assemblyUserId: string;
let matterId: string;
let assemblyBucketName: string;

let widenedFirmId: FirmId;
let widenedCookie: string;
let widenedUserId: string;
let widenedMatterId: string;
let widenedBucketName: string;

let frozenFirmId: FirmId;
let frozenCookie: string;
let frozenUserId: string;
let frozenMatterId: string;
let frozenBucketName: string;

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

// The complex field construct Word writes for an inserted merge field. `cachedResult` is what the
// document actually prints today — the text Word froze into the field the last time it was merged.
function mergeFieldParagraph(fieldName: string, cachedResult = `«${fieldName}»`): string {
  return (
    "<w:p>" +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> MERGEFIELD  ${fieldName}  \\* MERGEFORMAT </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:t>${cachedResult}</w:t></w:r>` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    "</w:p>"
  );
}

// The package shape a macro-bearing upload takes: the payload part, the content-type Default that
// declares it, the relationship that reaches it, and the macro-enabled main-document declaration.
function macroBearingOverrides(): TemplateOverrides {
  return {
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
  };
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

async function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
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

async function deleteCustomField(fieldId: string): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/custom-fields/fields/${fieldId}`, {
    method: "DELETE",
    headers: {
      origin: "https://example.com",
      cookie: widenedCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
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
  macrosStripped: boolean;
  macroPartsRemoved: number;
  mergeFieldsConverted: boolean;
  mergeFieldsDetected: {
    fieldName: string;
    mappedKey: string;
    mapsToKnownField: boolean;
    mappedFromLibrary: boolean;
    frozenText: string;
  }[];
  unconvertedMergeFields: {
    fieldName: string;
    part: string;
    occurrences: number;
    frozenText: string;
  }[];
  confirmedFieldMappings: { fieldName: string; mergeKey: string }[];
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

interface SeededFirm {
  readonly firmId: FirmId;
  readonly cookie: string;
  readonly userId: string;
  readonly bucketName: string;
}

// One firm with an owner signed in and its bucket named. Every block here gets its own, so no block's
// assertions depend on what the block above it registered — and so each starts with a fresh
// `expensive` rate-limit bucket.
async function seedOwnedFirm(name: string, email: string, bucketName: string): Promise<SeededFirm> {
  const { firmId: seededFirmId } = await seedFirm({ name });
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(seededFirmId, bucketName)
    .run();
  const owner = await seedCredentialedUser(email, { userName: name, firmId: seededFirmId });
  await mirrorMemberWithOwnerRole(owner.userId, name, seededFirmId);
  return {
    firmId: seededFirmId,
    cookie: await signInForSessionCookie(email),
    userId: owner.userId,
    bucketName,
  };
}

// An open matter on a seeded firm, with the numbering scheme its number is drawn from.
async function seedMatter(firm: SeededFirm, title: string, client: string): Promise<string> {
  const scheme = await put(
    "/api/v1/numbering-scheme",
    {
      segments: [
        { kind: "literal", text: "DA-" },
        { kind: "counter", padWidth: 4 },
      ],
    },
    firm.cookie,
  );
  expect(scheme.status, await scheme.clone().text()).toBe(200);
  const created = await post(
    "/api/v1/matters",
    {
      title,
      status: "open",
      responsibleMemberId: firm.userId,
      clientDisplayName: client,
    },
    firm.cookie,
  );
  expect(created.status, await created.clone().text()).toBe(201);
  return (await created.json()).matterId;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);

  const registrationFirm = await seedOwnedFirm(
    "Document Automation Firm",
    "automation-owner@example.com",
    "document-automation-firm-bucket",
  );
  ownerCookie = registrationFirm.cookie;

  mappingCookie = (
    await seedOwnedFirm(
      "Field Mapping Firm",
      "mapping-owner@example.com",
      "document-automation-mapping-bucket",
    )
  ).cookie;

  const assemblyFirm = await seedOwnedFirm(
    "Document Assembly Firm",
    "assembly-owner@example.com",
    "document-automation-assembly-bucket",
  );
  assemblyFirmId = assemblyFirm.firmId;
  assemblyCookie = assemblyFirm.cookie;
  assemblyUserId = assemblyFirm.userId;
  assemblyBucketName = assemblyFirm.bucketName;
  matterId = await seedMatter(assemblyFirm, "Riverside Contract Dispute", "Acme Holdings LLC");

  // The widened dictionary gets its own firm: it defines a custom field and uploads a letterhead, and
  // both are firm-wide facts that would otherwise change what every block above it sees.
  const widenedFirm = await seedOwnedFirm(
    "Widened Dictionary Firm",
    "widened-owner@example.com",
    "document-automation-widened-bucket",
  );
  widenedFirmId = widenedFirm.firmId;
  widenedCookie = widenedFirm.cookie;
  widenedUserId = widenedFirm.userId;
  widenedBucketName = widenedFirm.bucketName;
  widenedMatterId = await seedMatter(widenedFirm, "Engagement", "Northgate Industries");

  const frozenFirm = await seedOwnedFirm(
    "Frozen Field Firm",
    "frozen-owner@example.com",
    "document-automation-frozen-bucket",
  );
  frozenFirmId = frozenFirm.firmId;
  frozenCookie = frozenFirm.cookie;
  frozenUserId = frozenFirm.userId;
  frozenBucketName = frozenFirm.bucketName;
  frozenMatterId = await seedMatter(frozenFirm, "Harbourside Estate", "Beacon Trust");
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
    expect(manifest.fields.map((field) => field.key).toSorted()).toEqual([
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

  it("REGISTERS a Word merge-field template without conversion, recording what each field will print", async () => {
    // Conversion is opt-in: the firm's own uploaded document is never rewritten unasked. It is also
    // not refused — the fields are recorded against the template with the text they render, which is
    // what makes them visible to the field inspector and to every assembly instead of invisible.
    const response = await registerTemplate(
      templateDocx({ body: mergeFieldParagraph("matter.number", "2019-CV-00041") }),
      "Mail Merge Letter",
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as RegisteredTemplateBody;
    expect(body.mergeFieldsConverted).toBe(false);
    expect(body.unconvertedMergeFields).toEqual([
      expect.objectContaining({
        fieldName: "matter.number",
        part: "word/document.xml",
        occurrences: 1,
        frozenText: "2019-CV-00041",
      }),
    ]);
    // Registered, not converted — so no mapping was confirmed and no {{field}} was minted.
    expect(body.confirmedFieldMappings).toEqual([]);
    expect(body.fieldCount).toBe(0);

    // The field inspector shows them too, which is where an author goes to fix a template.
    const fields = await get(
      `/api/v1/templates/${body.templateId}/versions/${body.versionId}/fields`,
    );
    const manifest = (await fields.json()) as {
      unconvertedMergeFields: { fieldName: string; frozenText: string }[];
    };
    expect(manifest.unconvertedMergeFields).toEqual([
      expect.objectContaining({ fieldName: "matter.number", frozenText: "2019-CV-00041" }),
    ]);
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
    expect(body.unconvertedMergeFields).toEqual([]);
  });

  it("REFUSES a macro-bearing template without the strip opt-in, naming both ways through", async () => {
    // Removing macros rewrites the firm's own document, so it never happens unasked; storing them is
    // never an option, because a template is run against privileged client data. Both remedies are
    // named, and what was found rides the refusal.
    const response = await registerTemplate(
      templateDocx(macroBearingOverrides()),
      "Macro Letter Refused",
    );
    expect(response.status).toBe(422);
    const problem = (await response.json()) as {
      type: string;
      detail: string;
      errors?: { path: string; code: string; detail: string }[];
    };
    expect(problem.type).toContain("template-macro-consent-required");
    expect(problem.detail).toContain("asking for the macros to be removed");
    expect(problem.detail).toContain("macro-free copy");
    expect((problem.errors ?? []).map((error) => error.code)).toContain("macro-part");
  });

  it("strips the macro project when the caller opts in, and reports that it did", async () => {
    const response = await registerTemplate(templateDocx(macroBearingOverrides()), "Macro Letter", {
      stripMacros: true,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as RegisteredTemplateBody;
    expect(body.macrosStripped).toBe(true);
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

describe("the per-firm field-mapping library", () => {
  it("accumulates a confirmed mapping on the first import and reuses it on the second", async () => {
    // The engine never guesses that `ClientName` means `client.displayName`. The FIRM says so, once,
    // by converting a template whose fields carry the platform's own names alongside it — and from then
    // on every import of a document from the same source arrives already mapped.
    //
    // First import: the Word name is unrecognized, so it is reported as unmapped and converting it
    // would leave the field unbound. This is the state a migration starts in.
    const first = await registerTemplate(
      templateDocx({ body: mergeFieldParagraph("ClientName") }),
      "Migrated Letter One",
      {},
      mappingCookie,
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as RegisteredTemplateBody;
    expect(firstBody.mergeFieldsDetected[0]).toMatchObject({
      fieldName: "ClientName",
      mappedKey: "ClientName",
      mapsToKnownField: false,
      mappedFromLibrary: false,
    });

    // The firm confirms the meaning by converting a template that uses the platform's own name, which
    // is the mapping this library records.
    const confirming = await registerTemplate(
      templateDocx({ body: mergeFieldParagraph("client.displayName") }),
      "Migrated Letter Confirming",
      { convertMergeFields: true },
      mappingCookie,
    );
    expect(confirming.status).toBe(201);
    expect((await confirming.json()).confirmedFieldMappings).toEqual([
      { fieldName: "client.displayName", mergeKey: "client.displayName" },
    ]);

    // The library is visible: what this firm has confirmed, and how often it has been used.
    const listed = await get("/api/v1/merge-field-mappings", mappingCookie);
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as {
      data: { mappingId: string; fieldName: string; mergeKey: string; timesApplied: number }[];
    };
    const entry = page.data.find((row) => row.fieldName === "client.displayName");
    expect(entry).toMatchObject({ mergeKey: "client.displayName", timesApplied: 1 });

    // A later registration consults it: re-converting the same name reuses the stored answer and the
    // times-applied count moves, which is the evidence the library is being read and not just written.
    const second = await registerTemplate(
      templateDocx({ body: mergeFieldParagraph("client.displayName") }),
      "Migrated Letter Two",
      { convertMergeFields: true },
      mappingCookie,
    );
    expect(second.status).toBe(201);
    expect((await second.json()).mergeFieldsDetected[0]).toMatchObject({
      mappedKey: "client.displayName",
      // Confirmed once already, so this detection came THROUGH the library rather than past it.
      mappedFromLibrary: true,
    });
    const relisted = await get("/api/v1/merge-field-mappings", mappingCookie);
    const reentry = (await relisted.json()).data.find(
      (row) => row.fieldName === "client.displayName",
    );
    expect(reentry?.timesApplied).toBe(2);

    // And it is editable: a mapping is a statement the firm made, so it can withdraw it.
    const mappingId = entry?.mappingId ?? "";
    const deleted = await SELF.fetch(
      `https://example.com/api/v1/merge-field-mappings/${mappingId}`,
      {
        method: "DELETE",
        headers: { origin: "https://example.com", cookie: mappingCookie },
      },
    );
    expect(deleted.status).toBe(200);
    const afterDelete = (await (
      await get("/api/v1/merge-field-mappings", mappingCookie)
    ).json()) as {
      data: { fieldName: string }[];
    };
    expect(afterDelete.data.map((row) => row.fieldName)).not.toContain("client.displayName");
  });

  it("404s a delete of a mapping that does not exist", async () => {
    const response = await SELF.fetch(
      `https://example.com/api/v1/merge-field-mappings/documentTemplateFieldMapping_${"0".repeat(21)}`,
      { method: "DELETE", headers: { origin: "https://example.com", cookie: mappingCookie } },
    );
    expect(response.status).toBe(404);
  });

  it("is not reachable without a session", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/merge-field-mappings", {
      headers: { origin: "https://example.com" },
    });
    expect(response.status).toBe(401);
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
    expect((await queued.json()).status).toBe("queued");

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

  it("reports the frozen merge fields an assembled document carries, in the response and on the row", async () => {
    // A template registered without conversion still carries its Word merge fields. Nothing substitutes
    // them, so the produced document prints the text Word cached — a blank that does not look like a
    // blank, and the one hole the merge itself cannot see. The manifest recorded it at registration
    // precisely so the assembly can report it here.
    const registered = (await (
      await registerTemplate(
        templateDocx({
          body:
            paragraph("Matter {{matter.number}} — ") +
            mergeFieldParagraph("FileNo", "2019-CV-00041"),
        }),
        "Frozen Field Letter",
        {},
        frozenCookie,
      )
    ).json()) as RegisteredTemplateBody;
    expect(registered.unconvertedMergeFields).toHaveLength(1);

    const submitted = await post(
      `/api/v1/matters/${frozenMatterId}/assemblies`,
      { templateVersionId: registered.versionId },
      frozenCookie,
    );
    const { assemblyId } = (await submitted.json()) as { assemblyId: string };
    await documentAssemblyQueue(
      makeBatch({
        firmId: frozenFirmId,
        bucketName: frozenBucketName,
        assemblyId,
        matterId: frozenMatterId,
        templateVersionId: registered.versionId,
        folderId: null,
        requestedBy: frozenUserId,
      }).batch,
      env,
    );

    const state = (await (
      await get(`/api/v1/matters/${frozenMatterId}/assemblies/${assemblyId}`, frozenCookie)
    ).json()) as {
      status: string;
      outcome: string;
      absentFieldKeys: string[];
      frozenMergeFieldNames: string[];
      fileVersionId: string;
    };
    expect(state.status).toBe("done");
    // Everything the matter could supply resolved — and the document still needs a human, because a
    // field in it prints text left over from the template.
    expect(state.absentFieldKeys).toEqual([]);
    expect(state.frozenMergeFieldNames).toEqual(["FileNo"]);
    expect(state.outcome).toBe("succeeded_with_absences");

    // The provenance row records the same thing: NAMES only, never the frozen text, which is template
    // content rather than provenance.
    const row = await queryFirstRow<{
      frozen_field_names_json: string;
      frozen_field_count: number;
    }>(
      "SELECT frozen_field_names_json, frozen_field_count FROM document_assembly WHERE id = ?1",
      [assemblyId],
      frozenFirmId,
    );
    expect(JSON.parse(row?.frozen_field_names_json ?? "[]")).toEqual(["FileNo"]);
    expect(row?.frozen_field_count).toBe(1);
    expect(row?.frozen_field_names_json).not.toContain("2019-CV-00041");

    // And the produced document really does carry the stale text, which is what the report is about.
    const version = await queryFirstRow<{ r2_key: string }>(
      "SELECT r2_key FROM file_version WHERE id = ?1",
      [state.fileVersionId],
      frozenFirmId,
    );
    const object = await env.R2.get(version?.r2_key ?? "");
    const produced = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());
    const documentText = new TextDecoder().decode(readZipEntry(produced, "word/document.xml"));
    expect(documentText).toContain("2019-CV-00041");
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
    expect((await submitted.json()).type).toContain("template-not-activatable");
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

describe("a firm's own fields, and its letterhead, end to end", () => {
  it("binds a custom field by handle, renders it at its declared scale, and survives a rename", async () => {
    const defined = await post(
      "/api/v1/custom-fields/fields",
      { name: "Retainer cap", kind: "currency", target: "matter", attachmentId: null },
      widenedCookie,
    );
    expect(defined.status, await defined.clone().text()).toBe(201);
    const { id: customFieldId } = (await defined.json()) as { id: string };

    const valued = await put(
      "/api/v1/custom-fields/values",
      {
        fieldId: customFieldId,
        targetRowId: widenedMatterId,
        value: { kind: "number", number: 2500 },
      },
      widenedCookie,
    );
    expect(valued.status, await valued.clone().text()).toBe(200);

    // The field list the firm sees now carries its own field, keyed by the HANDLE a template binds.
    const catalogue = (await (await get("/api/v1/merge-fields", widenedCookie)).json()) as {
      fields: { key: string; source: string; description: string }[];
    };
    const entry = catalogue.fields.find((field) => field.key === `custom.${customFieldId}`);
    expect(entry).toMatchObject({ source: "customField", description: "Retainer cap" });

    const registered = (await (
      await registerTemplate(
        templateDocx({ body: paragraph(`Cap: {{custom.${customFieldId}}}`) }),
        "Retainer Letter",
        {},
        widenedCookie,
      )
    ).json()) as RegisteredTemplateBody;
    expect(registered.status).toBe("clean");

    // The rename happens BETWEEN registration and assembly: binding is by handle, so it changes
    // nothing about what the document produces.
    const renamed = await patch(
      `/api/v1/custom-fields/fields/${customFieldId}/name`,
      { name: "Engagement cap" },
      widenedCookie,
    );
    expect(renamed.status, await renamed.clone().text()).toBe(200);

    const produced = await assembleAndRead(registered.versionId);
    // A currency field's stored minor units render as money, not as the integer they are stored as.
    expect(produced.documentText).toContain("$2,500.00");
    expect(produced.absentFieldKeys).toEqual([]);

    // And the field cannot be destroyed out from under the template. A field with a stored value was
    // already undeletable, so the arm that matters here is the OTHER one: a field a template binds and
    // nothing has ever held a value for.
    const unusedField = await post(
      "/api/v1/custom-fields/fields",
      { name: "Filing venue", kind: "single-line", target: "matter", attachmentId: null },
      widenedCookie,
    );
    const { id: boundOnlyFieldId } = (await unusedField.json()) as { id: string };
    const deletableBefore = await deleteCustomField(boundOnlyFieldId);
    expect(deletableBefore.status, await deletableBefore.clone().text()).toBe(200);

    const rebound = await post(
      "/api/v1/custom-fields/fields",
      { name: "Filing venue", kind: "single-line", target: "matter", attachmentId: null },
      widenedCookie,
    );
    const { id: boundFieldId } = (await rebound.json()) as { id: string };
    await registerTemplate(
      templateDocx({ body: paragraph(`Venue: {{custom.${boundFieldId}}}`) }),
      "Venue Letter",
      {},
      widenedCookie,
    );
    const refused = await deleteCustomField(boundFieldId);
    expect(refused.status, await refused.clone().text()).toBe(409);
    expect(await refused.text()).toContain("document template");
  });

  it("draws the matter's office letterhead as a real picture, with its part, content type, and relationship", async () => {
    const location = await post(
      "/api/v1/locations",
      { name: "Riverside Office", numberCode: "RIV" },
      widenedCookie,
    );
    expect(location.status, await location.clone().text()).toBe(201);
    const { id: locationId } = (await location.json()) as { id: string };

    const set = await put(
      `/api/v1/locations/${locationId}/letterhead-logo`,
      { imageBase64: base64(pngFixture(400, 100)), printedWidthPoints: 144 },
      widenedCookie,
    );
    expect(set.status, await set.clone().text()).toBe(200);

    // The office's own settings report the mark WITHOUT its bytes.
    const detail = (await (await get(`/api/v1/locations/${locationId}`, widenedCookie)).json()) as {
      letterheadLogo: { contentType: string; widthPixels: number; printedWidthPoints: number };
    };
    expect(detail.letterheadLogo).toMatchObject({
      contentType: "image/png",
      widthPixels: 400,
      printedWidthPoints: 144,
    });

    const letterheadMatter = await seedMatterAtLocation(locationId);
    const registered = (await (
      await registerTemplate(
        templateDocx({ body: paragraph("{{location.letterheadLogo}}") }),
        "Letterhead Letter",
        {},
        widenedCookie,
      )
    ).json()) as RegisteredTemplateBody;

    const produced = await assembleAndRead(registered.versionId, letterheadMatter);
    // The four halves of a picture, over the bytes that were filed. A text assertion cannot see any of
    // them, which is exactly why they are asserted here.
    const parts = unzipSync(produced.bytes);
    const media = Object.keys(parts).filter((name) => name.startsWith("word/media/"));
    expect(media).toHaveLength(1);
    expect(new TextDecoder().decode(parts["[Content_Types].xml"])).toContain(
      'Extension="png" ContentType="image/png"',
    );
    const relationships = new TextDecoder().decode(parts["word/_rels/document.xml.rels"]);
    expect(relationships).toContain("relationships/image");
    expect(produced.documentText).toContain("<w:drawing>");
    // 144 points is two inches: 2 x 914400 EMU wide, and a quarter of that tall at 4:1.
    expect(produced.documentText).toContain('cx="1828800"');
    expect(produced.documentText).toContain('cy="457200"');
    expect(produced.documentText).not.toContain("{{");
  });

  it("shows a marker rather than losing the letterhead when the office has no logo", async () => {
    const registered = (await (
      await registerTemplate(
        templateDocx({ body: paragraph("{{location.letterheadLogo}}") }),
        "No Logo Letter",
        {},
        widenedCookie,
      )
    ).json()) as RegisteredTemplateBody;
    const produced = await assembleAndRead(registered.versionId);
    expect(produced.absentFieldKeys).toEqual(["location.letterheadLogo"]);
    expect(produced.documentText).toContain("[LOCATION LETTERHEAD LOGO]");
  });

  it("refuses a letterhead image that is not a PNG or a JPEG, whatever it is called", async () => {
    const location = await post(
      "/api/v1/locations",
      { name: "Refusal Office", numberCode: "REF" },
      widenedCookie,
    );
    const { id: locationId } = (await location.json()) as { id: string };
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const refused = await put(
      `/api/v1/locations/${locationId}/letterhead-logo`,
      { imageBase64: base64(svg), printedWidthPoints: 144 },
      widenedCookie,
    );
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain("PNG or a JPEG");
  });
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

// Submit an assembly, run the queue, and hand back the filed bytes plus what the run reported.
async function assembleAndRead(
  templateVersionId: string,
  onMatterId: string = widenedMatterId,
): Promise<{ bytes: Uint8Array; documentText: string; absentFieldKeys: string[] }> {
  const submitted = await post(
    `/api/v1/matters/${onMatterId}/assemblies`,
    { templateVersionId },
    widenedCookie,
  );
  expect(submitted.status, await submitted.clone().text()).toBe(202);
  const { assemblyId } = (await submitted.json()) as { assemblyId: string };
  await documentAssemblyQueue(
    makeBatch({
      firmId: widenedFirmId,
      bucketName: widenedBucketName,
      assemblyId,
      matterId: onMatterId,
      templateVersionId,
      folderId: null,
      requestedBy: widenedUserId,
    }).batch,
    env,
  );
  const state = (await (
    await get(`/api/v1/matters/${onMatterId}/assemblies/${assemblyId}`, widenedCookie)
  ).json()) as { status: string; fileVersionId: string | null; absentFieldKeys: string[] };
  expect(state.status).toBe("done");
  const version = await queryFirstRow<{ r2_key: string }>(
    "SELECT r2_key FROM file_version WHERE id = ?1",
    [state.fileVersionId],
    widenedFirmId,
  );
  const object = await env.R2.get(version?.r2_key ?? "");
  const bytes = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());
  return {
    bytes,
    documentText: new TextDecoder().decode(readZipEntry(bytes, "word/document.xml")),
    absentFieldKeys: state.absentFieldKeys,
  };
}

// A matter whose HOME OFFICE is the given location — the whole point of `location.*` resolving from the
// matter rather than from whoever pressed the button.
async function seedMatterAtLocation(locationId: string): Promise<string> {
  const created = await post(
    "/api/v1/matters",
    {
      title: "Letterhead matter",
      status: "open",
      responsibleMemberId: widenedUserId,
      clientDisplayName: "Riverside Partners",
      locationId,
    },
    widenedCookie,
  );
  expect(created.status, await created.clone().text()).toBe(201);
  return ((await created.json()) as { matterId: string }).matterId;
}

// The smallest PNG whose IHDR declares a size — all the engine reads out of one.
function pngFixture(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function queryFirstRow<T>(
  sql: string,
  bindings: unknown[],
  targetFirmId: FirmId = assemblyFirmId,
): Promise<T | undefined> {
  const { firmDatabaseFor } = await import("../src/firm-database/firm-database-proxy.ts");
  const database = firmDatabaseFor(env.FIRM_DATABASE, targetFirmId);
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
