/*
 * Registering a template — the three-step ceremony, out of the dialog so it is unit-testable
 * against fake ports.
 *
 * The steps are the contract's, in order: mint a staging slot and get a signed URL, PUT the bytes
 * straight to object storage (they never transit the Worker), then register the staged object as a
 * template. Registration is where the expensive work happens on the server — macro removal, the
 * placeholder normalization, the scrub, the scan — which is why the third step is the one that can
 * answer with findings rather than a bare handle, and why the outcome carries the whole report.
 *
 * THE KIND IS CHOSEN WHEN THE SLOT IS MINTED, not when the document is registered: the signed URL's
 * signature covers the content type, so a Word document uploaded into a PDF slot is refused by
 * storage. `templateKindForFile` reads the kind off the file so a person never has to say it.
 */
import { templatesRegister, templatesUpload } from "@magna-carta/api-client";
import type {
  RegisteredTemplate,
  RegisterTemplateRequest,
  TemplateUploadResponse,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { Failure } from "$lib/api/problem.ts";

export type TemplateKind = "wordProcessing" | "pdfForm";

/** The permission that lets a member register a template into the catalogue, or archive one. */
export const MANAGE_TEMPLATES_PERMISSION = "templates:manage";

/** How each kind reads to the person who chose the file, in the words the dialog says it in. */
export function templateKindSentence(kind: TemplateKind): string {
  return kind === "pdfForm" ? "Registers as a fillable-PDF form" : "Registers as a Word template";
}

/** What a person fills in before pressing Register. */
export interface RegisterTemplateDraft {
  readonly file: File;
  readonly kind: TemplateKind;
  readonly name: string;
  readonly description: string;
  /** Bind the template to one practice area, or null to offer it to every matter. */
  readonly matterTypeId: string | null;
  /** Bind the template to one office, or null to offer it from every office. */
  readonly locationId: string | null;
  readonly convertMergeFields: boolean;
  readonly stripMacros: boolean;
}

/** Where the ceremony has got to, for the dialog to narrate. */
export type RegisterStage = "reserving" | "uploading" | "registering" | "settled";

export type RegisterOutcome =
  /** The template is in the catalogue; the report says what registration found and did. */
  | { readonly kind: "registered"; readonly report: RegisteredTemplate }
  /** A step was refused or never answered. The catalogue is unchanged. */
  | { readonly kind: "failed"; readonly stage: RegisterStage; readonly failure: Failure };

/**
 * The three calls the ceremony makes, as an interface so a test can answer them without a server
 * and the live wiring below is the only place the generated client is named.
 */
export interface RegisterTemplatePorts {
  presign(kind: TemplateKind): Promise<TemplateUploadResponse>;
  putBytes(url: string, headers: Readonly<Record<string, string>>, file: File): Promise<void>;
  register(body: RegisterTemplateRequest, idempotencyKey: string): Promise<RegisteredTemplate>;
}

export interface RegisterTemplateOptions {
  readonly ports: RegisterTemplatePorts;
  /** The intent's key — stable across retries of the same registration (see $lib/api/write-intent.ts). */
  readonly idempotencyKey: string;
  /** Called as each stage begins, so the dialog can say what is happening. */
  readonly onStage?: (stage: RegisterStage) => void;
}

/** The kind a file registers as, read off its name. Null for a file that is neither. */
export function templateKindForFile(file: { readonly name: string }): TemplateKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return "wordProcessing";
  if (name.endsWith(".pdf")) return "pdfForm";
  return null;
}

/** What the picker offers, so a person is steered to the two kinds before choosing a file. */
export const TEMPLATE_FILE_ACCEPT = ".docx,.pdf";

/** The request body a draft registers with. Blank optional fields are sent as null, never as "". */
export function registrationBody(
  draft: RegisterTemplateDraft,
  uploadKey: string,
): RegisterTemplateRequest {
  const description = draft.description.trim();
  return {
    uploadKey,
    name: draft.name.trim(),
    description: description === "" ? null : description,
    matterTypeId: draft.matterTypeId,
    locationId: draft.locationId,
    kind: draft.kind,
    convertMergeFields: draft.convertMergeFields,
    stripMacros: draft.stripMacros,
  };
}

export async function registerTemplate(
  draft: RegisterTemplateDraft,
  options: RegisterTemplateOptions,
): Promise<RegisterOutcome> {
  const { ports, idempotencyKey, onStage } = options;

  onStage?.("reserving");
  let slot: TemplateUploadResponse;
  try {
    slot = await ports.presign(draft.kind);
  } catch (error) {
    return { kind: "failed", stage: "reserving", failure: failureOf(error) };
  }

  onStage?.("uploading");
  try {
    await ports.putBytes(slot.uploadUrl, slot.uploadHeaders, draft.file);
  } catch (error) {
    return { kind: "failed", stage: "uploading", failure: failureOf(error) };
  }

  onStage?.("registering");
  try {
    const report = await ports.register(registrationBody(draft, slot.uploadKey), idempotencyKey);
    onStage?.("settled");
    return { kind: "registered", report };
  } catch (error) {
    return { kind: "failed", stage: "registering", failure: failureOf(error) };
  }
}

/**
 * One finding from a registration report, in the reader's words. The report lists what was found
 * in the document and what was done to it; a person deciding whether the template is usable reads
 * these rather than the raw lists.
 */
export interface RegistrationFinding {
  readonly tone: "info" | "warning";
  readonly text: string;
}

function names(items: readonly { fieldName: string }[]): string {
  return items.map((item) => item.fieldName).join(", ");
}

/**
 * The part of a report that is about what the version BINDS — which a registration answers once,
 * and which a version's field manifest answers again whenever the template is opened. Both carry
 * the same four lists and the same warnings, so both read as the same findings.
 */
export type BindingReport = Pick<
  RegisteredTemplate,
  | "unconvertedMergeFields"
  | "legacyFormFields"
  | "unboundContentControls"
  | "unboundFormFields"
  | "warnings"
>;

/** The report as findings. Empty for a document that registered with nothing to remark on. */
export function registrationFindings(report: RegisteredTemplate): readonly RegistrationFinding[] {
  const findings: RegistrationFinding[] = [];
  if (report.macrosStripped) {
    findings.push({
      tone: "info",
      text:
        report.macroPartsRemoved === 0
          ? "Macro removal ran and found nothing to remove."
          : `Macro content was removed (${report.macroPartsRemoved} part${report.macroPartsRemoved === 1 ? "" : "s"}), so the registered document is not the one uploaded.`,
    });
  }
  if (report.mergeFieldsConverted && report.mergeFieldsDetected.length > 0) {
    findings.push({
      tone: "info",
      text: `${report.mergeFieldsDetected.length} Word merge field${report.mergeFieldsDetected.length === 1 ? " was" : "s were"} converted into this system's fields.`,
    });
  }
  findings.push(...bindingFindings(report));
  return findings;
}

/** What a version leaves unbound or frozen, as warnings. Empty for a version that binds cleanly. */
export function bindingFindings(report: BindingReport): readonly RegistrationFinding[] {
  const findings: RegistrationFinding[] = [];
  if (report.unconvertedMergeFields.length > 0) {
    findings.push({
      tone: "warning",
      text: `These Word merge fields were left as they are and will print their last saved text: ${names(report.unconvertedMergeFields)}. Add the template again with conversion turned on to fill them.`,
    });
  }
  if (report.legacyFormFields.length > 0) {
    findings.push({
      tone: "warning",
      text: `These fill-in-the-blank form fields cannot be filled by this system and will print their prompts: ${names(report.legacyFormFields)}.`,
    });
  }
  if (report.unboundContentControls.length > 0) {
    findings.push({
      tone: "warning",
      text: `${report.unboundContentControls.length} content control${report.unboundContentControls.length === 1 ? "" : "s"} in the document will print placeholder text instead of a merged value.`,
    });
  }
  if (report.unboundFormFields.length > 0) {
    findings.push({
      tone: "warning",
      text: `These boxes on the form are filled by nothing and will be left blank: ${names(report.unboundFormFields)}.`,
    });
  }
  for (const warning of report.warnings) {
    findings.push({ tone: "warning", text: `${warning.detail} (${warning.part})` });
  }
  return findings;
}

/** How many merge fields the version binds, said as a sentence. */
export function fieldCountSentence(
  report: Pick<RegisteredTemplate, "fieldCount" | "kind">,
): string {
  if (report.fieldCount === 0) {
    return report.kind === "pdfForm"
      ? "No box on the form is bound to a merge field, so every document built from it is the blank form."
      : "The document binds no merge fields, so every document built from it is a copy of it.";
  }
  return `It binds ${report.fieldCount} merge field${report.fieldCount === 1 ? "" : "s"}.`;
}

/**
 * The live ports, over the generated client. The PUT goes to the signed URL storage minted, with
 * the headers the signature covers passed through untouched — a byte written without them lands
 * where nothing can place it.
 */
export function liveRegisterTemplatePorts(fetchImpl: typeof fetch = fetch): RegisterTemplatePorts {
  return {
    async presign(kind) {
      const { data } = await templatesUpload({ query: { kind }, throwOnError: true });
      return data;
    },
    async putBytes(url, headers, file) {
      const response = await fetchImpl(url, { method: "PUT", headers: { ...headers }, body: file });
      if (!response.ok) {
        throw new Error(`Storage refused the upload (${response.status}).`);
      }
    },
    async register(body, idempotencyKey) {
      const { data } = await templatesRegister({
        body,
        headers: { "idempotency-key": idempotencyKey },
        throwOnError: true,
      });
      return data;
    },
  };
}
