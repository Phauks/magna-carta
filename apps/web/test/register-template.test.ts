/*
 * Registering a template, driven against fake ports.
 *
 * The ceremony is three calls in a fixed order, and the properties worth pinning are the ones a
 * dialog cannot see: that the kind chosen for the slot is the kind the file is, that the signed
 * headers reach the PUT untouched, that the idempotency key reaches the registration, and that a
 * failure names the step it happened at so a person knows whether anything was stored.
 */
import { describe, expect, it } from "vitest";
import type { RegisteredTemplate } from "@magna-carta/api-client";
import { ApiCallFailed } from "../src/lib/api/api-client.ts";
import {
  fieldCountSentence,
  registerTemplate,
  registrationBody,
  registrationFindings,
  templateKindForFile,
  type RegisterTemplateDraft,
  type RegisterTemplatePorts,
  type RegisterStage,
} from "../src/lib/templates/register-template.ts";

const file = (name: string) => new File(["bytes"], name);

const draft = (overrides: Partial<RegisterTemplateDraft> = {}): RegisterTemplateDraft => ({
  file: file("engagement.docx"),
  kind: "wordProcessing",
  name: "  Engagement letter ",
  description: "   ",
  matterTypeId: null,
  locationId: "location_reno",
  convertMergeFields: false,
  stripMacros: true,
  ...overrides,
});

const report = (overrides: Partial<RegisteredTemplate> = {}): RegisteredTemplate => ({
  templateId: "documentTemplate_1",
  versionId: "documentTemplateVersion_1",
  versionNumber: 1,
  kind: "wordProcessing",
  status: "clean",
  fieldCount: 4,
  macrosStripped: false,
  macroPartsRemoved: 0,
  mergeFieldsConverted: false,
  mergeFieldsDetected: [],
  unconvertedMergeFields: [],
  legacyFormFields: [],
  unboundContentControls: [],
  formFields: [],
  unboundFormFields: [],
  confirmedFieldMappings: [],
  warnings: [],
  ...overrides,
});

function recordingPorts(failAt?: RegisterStage) {
  const calls: string[] = [];
  const ports: RegisterTemplatePorts = {
    async presign(kind) {
      calls.push(`presign:${kind}`);
      if (failAt === "reserving") throw refusal(403, "You may not manage templates.");
      return {
        uploadKey: "templates/staging/abc",
        uploadUrl: "https://storage.example/abc",
        uploadHeaders: { "content-type": "application/pdf", "x-amz-meta-firm": "firm_1" },
      };
    },
    async putBytes(url, headers, uploaded) {
      calls.push(`put:${url}:${Object.keys(headers).sort().join(",")}:${uploaded.name}`);
      if (failAt === "uploading") throw new Error("Storage refused the upload (403).");
    },
    async register(body, idempotencyKey) {
      calls.push(`register:${body.uploadKey}:${idempotencyKey}`);
      if (failAt === "registering") throw refusal(422, "The document carries macros.");
      return report();
    },
  };
  return { calls, ports };
}

function refusal(status: number, detail: string): ApiCallFailed {
  return new ApiCallFailed({
    problem: { status, detail, title: "Refused" },
    request: "POST /api/v1/templates",
    failedAt: new Date(),
  });
}

describe("the kind of a file", () => {
  it("reads it off the name, case aside, and refuses anything else", () => {
    expect(templateKindForFile(file("Letter.DOCX"))).toBe("wordProcessing");
    expect(templateKindForFile(file("form.pdf"))).toBe("pdfForm");
    expect(templateKindForFile(file("letter.doc"))).toBeNull();
    expect(templateKindForFile(file("sheet.xlsx"))).toBeNull();
  });
});

describe("the registration body", () => {
  it("trims the name and sends a blank description as null", () => {
    const body = registrationBody(draft(), "templates/staging/abc");
    expect(body.name).toBe("Engagement letter");
    expect(body.description).toBeNull();
    expect(body.matterTypeId).toBeNull();
    expect(body.locationId).toBe("location_reno");
    expect(body.kind).toBe("wordProcessing");
    expect(body.stripMacros).toBe(true);
    expect(body.convertMergeFields).toBe(false);
  });
});

describe("the ceremony", () => {
  it("presigns for the draft's kind, PUTs with the signed headers, registers with the intent's key", async () => {
    const { calls, ports } = recordingPorts();
    const stages: RegisterStage[] = [];
    const outcome = await registerTemplate(draft({ kind: "pdfForm", file: file("form.pdf") }), {
      ports,
      idempotencyKey: "key-1",
      onStage: (stage) => stages.push(stage),
    });
    expect(outcome.kind).toBe("registered");
    expect(calls).toEqual([
      "presign:pdfForm",
      "put:https://storage.example/abc:content-type,x-amz-meta-firm:form.pdf",
      "register:templates/staging/abc:key-1",
    ]);
    expect(stages).toEqual(["reserving", "uploading", "registering", "settled"]);
  });

  it("names the step a refusal happened at, and stops there", async () => {
    for (const stage of ["reserving", "uploading", "registering"] as const) {
      const { calls, ports } = recordingPorts(stage);
      const outcome = await registerTemplate(draft(), { ports, idempotencyKey: "key-2" });
      expect(outcome.kind).toBe("failed");
      if (outcome.kind !== "failed") continue;
      expect(outcome.stage).toBe(stage);
      const expectedCalls = { reserving: 1, uploading: 2, registering: 3 }[stage];
      expect(calls).toHaveLength(expectedCalls);
    }
  });

  it("carries the server's own words on a refusal, and a bare transport record otherwise", async () => {
    const refused = await registerTemplate(draft(), {
      ports: recordingPorts("registering").ports,
      idempotencyKey: "key-3",
    });
    expect(refused.kind === "failed" && refused.failure.problem?.detail).toBe(
      "The document carries macros.",
    );
    const dropped = await registerTemplate(draft(), {
      ports: recordingPorts("uploading").ports,
      idempotencyKey: "key-4",
    });
    expect(dropped.kind === "failed" && dropped.failure.problem).toBeNull();
  });
});

describe("the report as findings", () => {
  it("has nothing to remark on for a clean document", () => {
    expect(registrationFindings(report())).toEqual([]);
    expect(fieldCountSentence(report())).toBe("It binds 4 merge fields.");
  });

  it("warns about every kind of blank the document will print", () => {
    const findings = registrationFindings(
      report({
        macrosStripped: true,
        macroPartsRemoved: 2,
        unconvertedMergeFields: [
          {
            fieldName: "ClientName",
            mappedKey: "",
            part: "word/document.xml",
            occurrences: 1,
            form: "simple",
            mapsToKnownField: false,
            frozenText: "Jane",
          },
        ],
        unboundFormFields: [
          {
            fieldName: "Box7",
            kind: "text",
            page: 1,
            required: false,
            reason: "no-confirmed-mapping",
            proposedMergeKey: "",
            frozenText: "",
          },
        ],
        warnings: [
          { code: "run-split", part: "word/header1.xml", detail: "A placeholder was rejoined." },
        ],
      }),
    );
    expect(findings.map((finding) => finding.tone)).toEqual([
      "info",
      "warning",
      "warning",
      "warning",
    ]);
    expect(findings[1]?.text).toContain("ClientName");
    expect(findings[2]?.text).toContain("Box7");
    expect(findings[3]?.text).toContain("word/header1.xml");
  });

  it("says plainly when a form binds nothing", () => {
    expect(fieldCountSentence(report({ kind: "pdfForm", fieldCount: 0 }))).toContain("blank form");
  });
});
