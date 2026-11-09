import { env } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import formFixtures from "virtual:document-assembly-form-fixtures";
import { beforeAll, describe, expect, it } from "vitest";
import { documentAssemblyQueue } from "../src/background/assemblies/assembly-consumer.ts";
import type { DocumentAssemblyMessage } from "../src/assemblies/assembly-types.ts";
import type { ProblemBody } from "../src/http/contracts/problem.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Fillable-PDF form templates, end to end under Miniflare: register the firm's own form, confirm which
// merge field each box is filled from, assemble it onto a matter, and confirm the filled PDF reached the
// matter's File Manager THROUGH THE INGEST CHOKEPOINT — the same `pending` version and completed upload
// session a word-processing assembly produces, never a row written straight to `clean`.
//
// The fixture is the one the document-assembly package's own tests assert the manifest against, inlined
// by the `documentAssemblyFormFixtures` plugin in vitest.config.ts. One copy of the bytes: a second
// committed copy here could drift from the field set the package is tested against, and nothing would
// notice.

const FORM_BYTES = Uint8Array.from(atob(formFixtures["intake-form.pdf"] ?? ""), (character) =>
  character.charCodeAt(0),
);

let firmId: FirmId;
let cookie: string;
let userId: string;
let bucketName: string;
let matterId: string;

// A SECOND FIRM, whose mapping library stays empty. The library is a firm-wide fact and the first
// registration here fills it, so "a form that binds nothing" is only observable on a firm that has
// confirmed nothing — the same reason every block of the word-processing suite gets its own firm.
let unboundCookie: string;

async function post(
  path: string,
  body: unknown,
  sessionCookie: string,
  environmentOverride: Record<string, unknown> = {},
): Promise<Response> {
  const { createApp } = await import("../src/http/app.ts");
  return createApp().request(
    path,
    {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
    { ...env, ...environmentOverride },
  );
}

async function get(path: string, sessionCookie: string): Promise<Response> {
  const { createApp } = await import("../src/http/app.ts");
  return createApp().request(path, { headers: { cookie: sessionCookie } }, env);
}

async function put(path: string, body: unknown, sessionCookie: string): Promise<Response> {
  const { createApp } = await import("../src/http/app.ts");
  return createApp().request(
    path,
    {
      method: "PUT",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function queryFirstRow<T>(sql: string, bindings: readonly unknown[]): Promise<T | undefined> {
  const { firmDatabaseFor } = await import("../src/firm-database/firm-database-proxy.ts");
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(sql)
    .bind(...bindings)
    .all<T>();
  return results[0];
}

interface FormFieldBody {
  fieldName: string;
  kind: string;
  page: number | null;
  required: boolean;
  options: string[];
  mergeKey: string;
  boundFromLibrary: boolean;
  proposedMergeKey: string;
  unboundReason: string | null;
}

interface RegisteredFormBody {
  templateId: string;
  versionId: string;
  kind: string;
  status: string;
  fieldCount: number;
  formFields: FormFieldBody[];
  unboundFormFields: { fieldName: string; reason: string; proposedMergeKey: string }[];
  confirmedFieldMappings: { fieldName: string; mergeKey: string }[];
  warnings: { code: string; detail: string }[];
}

// The boxes on the fixture form that resolve against the shipped dictionary, so the registered template
// actually fills something in on assembly.
const CONFIRMED_MAPPINGS = [
  { fieldName: "Client_Name", mergeKey: "client.displayName" },
  { fieldName: "Client_Name_Verification", mergeKey: "client.displayName" },
  { fieldName: "Petitioner_Address", mergeKey: "matter.number" },
];

// A DEPLOYED engine that answers clean over bytes that still hold executable content. The pool binds
// an engine-less stub by default (SCAN_SERVICE_STUB_SCRIPT in vitest.config.ts), whose honest
// `unscanned`/`no-engine` cannot exercise the clean branch — and the clean branch is the only one the
// active-content badge lives on. Overriding the binding in the request env is how this app drives an
// engine it cannot run, the same way test/scan-unreachable-engine-seam.test.ts drives an unreachable
// one; it also sidesteps the bytes entirely, which matters here because the registration route scans
// the output of the form scrub and the scrub re-serializes the document.
const activeContentScanService: Fetcher = {
  fetch: () =>
    Promise.resolve(
      Response.json({
        engineVersion: "test-engine/1",
        clam: { state: "clean" },
        heuristic: { kind: "active-content" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 1 },
      }),
    ),
} as unknown as Fetcher;

// A DEPLOYED engine that will not answer — the placeholder worker, or a Container that is not up.
// The adapter turns a 5xx into ScanFaultError, which is a FAULT rather than a verdict.
const unreachableScanService: Fetcher = {
  fetch: () => Promise.resolve(new Response("placeholder", { status: 503 })),
} as unknown as Fetcher;

async function stageForm(sessionCookie: string): Promise<string> {
  const minted = await post("/api/v1/templates/upload?kind=pdfForm", {}, sessionCookie);
  expect(minted.status, await minted.clone().text()).toBe(200);
  const { uploadKey } = await readJson<{ uploadKey: string }>(minted);
  await env.R2.put(uploadKey, FORM_BYTES as unknown as ArrayBuffer);
  return uploadKey;
}

async function registerForm(
  name: string,
  fieldMappings: readonly { fieldName: string; mergeKey: string }[] = CONFIRMED_MAPPINGS,
  sessionCookie = cookie,
  environmentOverride: Record<string, unknown> = {},
): Promise<Response> {
  const uploadKey = await stageForm(sessionCookie);
  return post(
    "/api/v1/templates",
    { uploadKey, name, kind: "pdfForm", fieldMappings },
    sessionCookie,
    environmentOverride,
  );
}

function makeBatch(message: DocumentAssemblyMessage): {
  batch: MessageBatch<DocumentAssemblyMessage>;
  acks: string[];
} {
  const acks: string[] = [];
  const batch = {
    queue: "magna-carta-production-document-assembly",
    messages: [
      {
        id: "form-assembly-msg",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push("form-assembly-msg"),
        retry: () => {
          throw new Error("a typed failure must be acked, never retried");
        },
      },
    ],
  } as unknown as MessageBatch<DocumentAssemblyMessage>;
  return { batch, acks };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);

  const seeded = await seedFirm({ name: "Fillable Form Firm" });
  firmId = seeded.firmId;
  bucketName = "pdf-form-template-firm-bucket";
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, bucketName)
    .run();
  const owner = await seedCredentialedUser("form-owner@example.com", {
    userName: "Fillable Form Firm",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Fillable Form Firm", firmId);
  userId = owner.userId;
  cookie = await signInForSessionCookie("form-owner@example.com");

  const scheme = await put(
    "/api/v1/numbering-scheme",
    {
      segments: [
        { kind: "literal", text: "FF-" },
        { kind: "counter", padWidth: 4 },
      ],
    },
    cookie,
  );
  expect(scheme.status, await scheme.clone().text()).toBe(200);
  const created = await post(
    "/api/v1/matters",
    {
      title: "Guardianship Petition",
      status: "open",
      responsibleMemberId: userId,
      clientDisplayName: "Ines Calloway",
    },
    cookie,
  );
  expect(created.status, await created.clone().text()).toBe(201);
  matterId = (await readJson<{ matterId: string }>(created)).matterId;

  const unboundFirm = await seedFirm({ name: "Unbound Form Firm" });
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(unboundFirm.firmId, "pdf-form-unbound-firm-bucket")
    .run();
  const unboundOwner = await seedCredentialedUser("unbound-form-owner@example.com", {
    userName: "Unbound Form Firm",
    firmId: unboundFirm.firmId,
  });
  await mirrorMemberWithOwnerRole(unboundOwner.userId, "Unbound Form Firm", unboundFirm.firmId);
  unboundCookie = await signInForSessionCookie("unbound-form-owner@example.com");
});

describe("registering a fillable PDF as a template", () => {
  it("records the kind, the whole field set, and the boxes nothing fills in", async () => {
    const response = await registerForm("Guardianship Intake Form");
    expect(response.status, await response.clone().text()).toBe(201);
    const body = await readJson<RegisteredFormBody>(response);

    expect(body.kind).toBe("pdfForm");
    expect(body.status).toBe("clean");
    // Three boxes bound, and two of them fill the same merge field.
    expect(body.fieldCount).toBe(2);
    expect(body.formFields).toHaveLength(10);
    expect(body.confirmedFieldMappings).toEqual(
      [...CONFIRMED_MAPPINGS].sort((left, right) => left.fieldName.localeCompare(right.fieldName)),
    );

    // Every box the form declares is accounted for, and the ones nothing fills in say why.
    const reasons = new Map(body.unboundFormFields.map((field) => [field.fieldName, field.reason]));
    expect(reasons.get("Unstated_Box")).toBe("unclassified");
    expect(reasons.get("Print_This_Form")).toBe("not-fillable");
    expect(reasons.get("Attorney_Signature")).toBe("not-fillable");
    expect(reasons.get("Fee_Waiver_Requested")).toBe("no-confirmed-mapping");

    // A box named exactly like a merge field is PROPOSED and stays unbound until somebody confirms it.
    const proposed = body.unboundFormFields.find((field) => field.fieldName === "matter.number");
    expect(proposed?.proposedMergeKey).toBe("matter.number");
    expect(body.formFields.find((field) => field.fieldName === "matter.number")?.mergeKey).toBe("");

    // The page a person reads is 1-based.
    expect(body.formFields.find((field) => field.fieldName === "Filing_County")?.page).toBe(2);
    expect(
      body.formFields.find((field) => field.fieldName === "Petitioner_Address")?.required,
    ).toBe(true);

    expect(body.warnings.map((warning) => warning.code)).toContain("unbound-form-field");

    // The version row carries the kind, so the assembly job branches on a stored fact.
    const version = await queryFirstRow<{ kind: string; normalizer_version: number }>(
      "SELECT kind, normalizer_version FROM document_template_version WHERE id = ?1",
      [body.versionId],
    );
    expect(version?.kind).toBe("pdfForm");
    expect(version?.normalizer_version).toBe(0);
  });

  it("writes the confirmed mappings to the firm's library, so a second form arrives already bound", async () => {
    const listed = await get("/api/v1/merge-field-mappings", cookie);
    expect(listed.status).toBe(200);
    const body = await readJson<{ data: { fieldName: string; mergeKey: string }[] }>(listed);
    const byName = new Map(body.data.map((row) => [row.fieldName, row.mergeKey]));
    expect(byName.get("Client_Name")).toBe("client.displayName");

    // Registered again with NO mappings in the request: the library binds them.
    const second = await registerForm("Second Intake Form", []);
    expect(second.status, await second.clone().text()).toBe(201);
    const secondBody = await readJson<RegisteredFormBody>(second);
    expect(secondBody.fieldCount).toBe(2);
    expect(
      secondBody.formFields.find((field) => field.fieldName === "Client_Name")?.boundFromLibrary,
    ).toBe(true);
    // A binding that came out of the library is not re-confirmed.
    expect(secondBody.confirmedFieldMappings).toEqual([]);
  });

  it("refuses a mapping onto a merge field this firm does not have", async () => {
    const response = await registerForm("Broken Binding Form", [
      { fieldName: "Client_Name", mergeKey: "custom.customField_missing" },
    ]);
    expect(response.status).toBe(422);
    const problem = await readJson<ProblemBody>(response);
    expect(problem.detail).toContain("custom.customField_missing");
  });

  it("says so when a form binds nothing at all", async () => {
    const response = await registerForm("Wholly Unbound Form", [], unboundCookie);
    expect(response.status).toBe(201);
    const body = await readJson<RegisteredFormBody>(response);
    expect(body.fieldCount).toBe(0);
    const noPlaceholders = body.warnings.find((warning) => warning.code === "no-placeholders");
    expect(noPlaceholders?.detail).toMatch(/none of them is bound/);
  });

  it("shows the boxes and the pages on the field-list surface", async () => {
    const registered = await readJson<RegisteredFormBody>(await registerForm("Inspected Form"));
    const response = await get(
      `/api/v1/templates/${registered.templateId}/versions/${registered.versionId}/fields`,
      cookie,
    );
    expect(response.status).toBe(200);
    const body = await readJson<{
      kind: string;
      fields: {
        key: string;
        parts: string[];
        formFields: { fieldName: string; page: number | null }[];
      }[];
      unboundFormFields: { fieldName: string }[];
    }>(response);
    expect(body.kind).toBe("pdfForm");
    const clientName = body.fields.find((field) => field.key === "client.displayName");
    expect(clientName?.formFields.map((site) => site.fieldName)).toEqual([
      "Client_Name",
      "Client_Name_Verification",
    ]);
    expect(clientName?.parts).toEqual(["page 1", "page 2"]);
    expect(body.unboundFormFields.length).toBeGreaterThan(0);
  });

  it("badges a registered form the engine reports as clean but carrying executable content", async () => {
    // The route recorded the reason for an `unscanned` verdict and null for a `clean` one, so the
    // only signal the platform computes about executable content was dropped on the firm's own court
    // forms — the documents most likely to arrive from outside and be run against privileged data.
    // Clean-with-active-content is the ONE verdict the old expression and `scanDetailFor` disagree
    // on, which is why the engine has to be a deployed one answering clean; the pool's engine-less
    // stub returns `unscanned`, and both implementations write `no-engine` for that.
    const registered = await readJson<RegisteredFormBody>(
      await registerForm("Active Content Form", CONFIRMED_MAPPINGS, cookie, {
        SCAN_SERVICE: activeContentScanService,
      }),
    );
    expect(registered.status).toBe("clean");

    const row = await queryFirstRow<{ scan_verdict: string; scan_detail: string | null }>(
      "SELECT scan_verdict, scan_detail FROM document_template_version WHERE id = ?1",
      [registered.versionId],
    );
    expect(row).toMatchObject({ scan_verdict: "clean", scan_detail: "active-content" });
  });

  it("refuses with a retryable 503 when the engine is deployed and will not answer", async () => {
    // The scan runs inside the idempotent effect, whose callback owes a write and a response code
    // rather than a Response — so the fault used to propagate as an Error ID, sending a member to
    // support over a Container that is simply not up. `scan-diagnose` already answered the identical
    // fault with a 503; this is the same answer on the registration path.
    const response = await registerForm("Unreachable Engine Form", CONFIRMED_MAPPINGS, cookie, {
      SCAN_SERVICE: unreachableScanService,
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = await readJson<{ type: string; detail: string }>(response);
    expect(problem.type).toContain("service-unavailable");
    // Never a verdict: an engine that did not answer has not pronounced this template anything.
    expect(problem.detail).toContain("not been scanned");

    // Nothing was registered — the effect threw before its write.
    const registered = await queryFirstRow<{ n: number }>(
      "SELECT COUNT(*) AS n FROM document_template WHERE name = ?1",
      ["Unreachable Engine Form"],
    );
    expect(registered?.n).toBe(0);
  });
});

describe("assembling a form template, end to end through the ingest chokepoint", () => {
  it("fills the firm's own form and files the PDF as a scanned matter document", async () => {
    const registered = await readJson<RegisteredFormBody>(await registerForm("Filed Intake Form"));

    const submitted = await post(
      `/api/v1/matters/${matterId}/assemblies`,
      { templateVersionId: registered.versionId },
      cookie,
    );
    expect(submitted.status, await submitted.clone().text()).toBe(202);
    const { assemblyId } = await readJson<{ assemblyId: string }>(submitted);

    // A form template produces a PDF whether or not the caller asked for one — the poll says so from
    // the moment of submit, so a caller knows before the document lands that it can be sealed.
    const queued = await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, cookie);
    expect((await readJson<{ outputFormat: string }>(queued)).outputFormat).toBe("pdf");

    const { batch, acks } = makeBatch({
      firmId,
      bucketName,
      assemblyId,
      matterId,
      templateVersionId: registered.versionId,
      folderId: null,
      outputFormat: "pdf",
      requestedBy: userId,
    });
    await documentAssemblyQueue(batch, env);
    expect(acks).toHaveLength(1);

    const polled = await get(`/api/v1/matters/${matterId}/assemblies/${assemblyId}`, cookie);
    const state = await readJson<{
      status: string;
      outcome: string | null;
      fileId: string | null;
      fileVersionId: string | null;
      absentFieldKeys: string[];
      frozenMergeFieldNames: string[];
    }>(polled);
    expect(state.status).toBe("done");
    expect(state.fileVersionId).not.toBeNull();
    // The matter supplies both bound fields, so nothing is absent — but the form's own unbound boxes
    // are reported, which is what makes the assembly `succeeded_with_absences` rather than a document
    // that reads as finished with blanks in it.
    expect(state.absentFieldKeys).toEqual([]);
    expect(state.frozenMergeFieldNames).toContain("Fee_Waiver_Requested (an unbound form box)");
    expect(state.frozenMergeFieldNames).toContain("Unstated_Box (a form box of no stated type)");
    // A push button and a signature field are not holes a merge could close, so they are not reported.
    expect(state.frozenMergeFieldNames.some((name) => name.startsWith("Print_This_Form"))).toBe(
      false,
    );
    expect(state.outcome).toBe("succeeded_with_absences");

    // THE CHOKEPOINT ASSERTION, unchanged for a form: the produced version was staged `pending` through
    // initiateUpload and its upload session completed. There is no second path to `clean`.
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

    // The filed bytes are a PDF, and they carry the matter's values in the boxes the firm confirmed.
    const object = await env.R2.get(version?.r2_key ?? "");
    expect(object).not.toBeNull();
    const produced = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());
    const { ensureReady, readForm } = await import("@magna-carta/pdf");
    const wasm = (await import("@magna-carta/pdf/src/pkg/pdf_core_bg.wasm")).default;
    await ensureReady(wasm);
    const filled = new Map((await readForm(produced)).map((field) => [field.name, field.value]));
    expect(filled.get("Client_Name")).toBe("Ines Calloway");
    expect(filled.get("Client_Name_Verification")).toBe("Ines Calloway");
    expect(filled.get("Petitioner_Address")).toMatch(/^FF-\d+$/);
    // INTERACTIVE BY DEFAULT: the boxes are still there, so whoever receives the document can complete
    // what the firm left them and correct what it got wrong. Whether a filed form should be flattened
    // instead is an owner decision, and flattening cannot be undone.
    expect(filled.size).toBe(10);

    // The filed document is named and typed as a PDF, so the file surface and the seal both see one.
    const file = await queryFirstRow<{ name: string }>("SELECT name FROM file WHERE id = ?1", [
      state.fileId,
    ]);
    expect(file?.name.endsWith(".pdf")).toBe(true);
  });

  it("refuses a word-processing output format for a form template, at submit", async () => {
    const registered = await readJson<RegisteredFormBody>(await registerForm("Docx Refusal Form"));
    const submitted = await post(
      `/api/v1/matters/${matterId}/assemblies`,
      { templateVersionId: registered.versionId, outputFormat: "docx" },
      cookie,
    );
    expect(submitted.status).toBe(422);
    const problem = await readJson<ProblemBody>(submitted);
    expect(problem.detail).toContain("fillable PDF");
  });
});
