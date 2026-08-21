import { lookupDictionaryEntry, type DictionaryEntry } from "./dictionary.ts";
import type { ConfirmedMergeFieldMapping } from "./normalize.ts";
import type {
  AcroFormFieldKind,
  FieldManifest,
  ManifestField,
  ManifestFormFieldSite,
  NormalizationWarning,
  UnboundFormField,
  UnboundFormFieldReason,
} from "./types.ts";

// Registering a firm-supplied FILLABLE PDF as a template.
//
// A Word template's field manifest is AUTHORED: a person types `{{matter.number}}` and the key is the
// binding. A form template's manifest is DISCOVERED: the AcroForm carries the form's own field names —
// `Petitioner_Name_1`, `TextField12`, whatever the court's drafting tool minted — which are the firm's
// text and cannot be trusted to lex as a merge key. That is the same problem the Word `MERGEFIELD`
// conversion faced, and it takes the same answer: a proposed mapping per field, CONFIRMED BY A HUMAN,
// stored in the firm's own mapping library, never inferred from resemblance.
//
// So this pass reads, classifies, and reports; it binds only what a person has already said. What comes
// out is a `FieldManifest` in the same shape a Word registration produces, so the field-binding index,
// the custom-field hard-delete guard, and the field-list surface read it without knowing which kind of
// template they are looking at.
//
// TWO THINGS THIS PASS WILL NOT DO, both for the same reason — a document that reads as finished and is
// not is the worst thing this subsystem can produce:
//
//   It never drops a field. Every terminal field the form declares comes out either bound (in
//   `fields`) or listed on `unboundFormFields` with the reason it is not. A field the platform has been
//   bitten by twice — a Word `FORMTEXT`, a content control showing its placeholder — is a field that
//   bound nothing and reported no absence, and the document printed the prompt.
//
//   It never defaults a type. A field whose interactive role the engine could not establish is
//   `unclassified` and unbound. Filling it as text would write an appearance stream into a widget
//   nobody classified, and an appearance stream prints.

// ---------------------------------------------------------------------------------------------
// The engine seam
// ---------------------------------------------------------------------------------------------

// One AcroForm field as the PDF engine reports it. Injected rather than imported, exactly as the
// metadata scrub is on the word-processing path: this package holds no WebAssembly, no page model, and
// no opinion about PDF syntax, and the caller wires `@magna-carta/pdf`.
export interface AcroFormFieldReading {
  // The fully-qualified field name, ancestor names dot-joined.
  readonly name: string;
  // The engine's own word for the field's interactive role, taken as a PLAIN STRING on purpose: a role
  // this package does not recognize becomes `unclassified` rather than a default, and an engine that
  // grows a seventh role cannot silently start filling it.
  readonly kind: string;
  // Whether the form declares the field must be answered (/Ff bit 2).
  readonly required: boolean;
  // 0-based page index of the field's first widget, or null when no page carries one.
  readonly page: number | null;
  // What the stored document holds in the field today.
  readonly value: string | boolean | null;
  // Display entries for a choice field; on-state names for a radio group.
  readonly options: readonly string[];
  readonly readOnly: boolean;
}

// Read the AcroForm field set from PDF bytes. Returns undefined when the bytes are not a PDF this
// engine can read at all — a refusal, never an empty field set, because "this is not a PDF" and "this
// PDF has no fillable fields" are different things to tell an administrator.
export type AcroFormReader = (
  bytes: Uint8Array,
) => Promise<readonly AcroFormFieldReading[] | undefined>;

// The engine roles this package understands. Anything else is `unclassified`.
const ENGINE_FIELD_KINDS: Readonly<Record<string, AcroFormFieldKind>> = {
  text: "text",
  checkbox: "checkbox",
  radio: "radio",
  choice: "choice",
  pushButton: "pushButton",
  signature: "signature",
};

export function classifyFormFieldKind(engineKind: string): AcroFormFieldKind {
  return ENGINE_FIELD_KINDS[engineKind] ?? "unclassified";
}

// The four roles a merge value can be written into. A push button carries an action and a signature
// field is filled by the signing ceremony, so neither is a hole an assembly can close; an unclassified
// field is one nothing may write into until somebody says what it is.
const FILLABLE_KINDS: ReadonlySet<AcroFormFieldKind> = new Set<AcroFormFieldKind>([
  "text",
  "checkbox",
  "radio",
  "choice",
]);

export function isFillableFormFieldKind(kind: AcroFormFieldKind): boolean {
  return FILLABLE_KINDS.has(kind);
}

// ---------------------------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------------------------

export type FormTemplatePreparationFailureReason =
  // The upload is not a PDF, or is one this engine will not read (over the size cap, a decompression
  // bomb, encrypted).
  | "not-a-pdf-form"
  // The PDF parsed and carries no interactive form at all. Refused rather than registered empty: a form
  // template with no fields is a template every assembly of which produces the same document, and the
  // firm meant to upload a fillable one.
  | "no-form-fields"
  // The scrub could not process the document, or removed the interactive form along with everything
  // else. Either way the bytes that would be stored are not a form template.
  | "scrub-failed"
  // A confirmed mapping names a merge key the firm's dictionary does not have. Refused rather than
  // recorded, on the same terms a `{{key}}` naming no merge field refuses a Word template: a binding to
  // a key nothing can resolve is a field that will be blank in every document, decided at registration
  // where a person is looking rather than at 4:55pm on a filing deadline.
  | "binding-names-unknown-field";

export interface FormTemplatePreparation {
  // The bytes to store as the template version: the uploaded form, scrubbed.
  readonly bytes: Uint8Array;
  readonly manifest: FieldManifest;
  readonly warnings: readonly NormalizationWarning[];
  // The mappings this registration confirmed, for the firm's library — the same shape and the same
  // library the Word conversion writes to, so a firm that has already said what `ClientName` means does
  // not say it again for a form that uses the same name.
  readonly confirmedMergeFieldMappings: readonly ConfirmedMergeFieldMapping[];
  // Every terminal field the stored form declares, in reading order — down the pages, then by name.
  // Reported so a registration response can show the whole field set, bound and unbound together, which
  // is what an administrator confirms mappings against; the order is the form's own so they can work
  // down it with the document open beside them, rather than the depth-first order the field tree
  // happened to be written in.
  readonly formFields: readonly FormFieldReport[];
}

// One field of the form as the registration reports it back: what it is, where it is, and what (if
// anything) it was bound to.
export interface FormFieldReport {
  readonly fieldName: string;
  readonly kind: AcroFormFieldKind;
  readonly page: number | null;
  readonly required: boolean;
  readonly options: readonly string[];
  // The merge key this field is bound to, or the empty string when nothing binds it.
  readonly mergeKey: string;
  // Whether the binding came from the firm's stored library rather than from this request. The
  // difference is what an administrator is being asked to look at, so it is reported rather than
  // blended into one "bound" flag.
  readonly boundFromLibrary: boolean;
  readonly proposedMergeKey: string;
  readonly unboundReason: UnboundFormFieldReason | null;
}

export type FormTemplatePreparationResult =
  | { readonly ok: true; readonly preparation: FormTemplatePreparation }
  | {
      readonly ok: false;
      readonly reason: FormTemplatePreparationFailureReason;
      readonly detail: string;
      // Reported on a refusal too, and especially then: a registration refused because one mapping
      // names a key the firm does not have is refused with the whole field set, so the caller can
      // present the correction rather than a dead end.
      readonly formFields: readonly FormFieldReport[];
    };

export interface FormTemplatePreparationOptions {
  // The dictionary AS THIS FIRM HAS IT — the platform's keys plus its own `custom.<handle>` bindings.
  // A binding is checked against this, so a mapping onto a field the firm archived is refused by name.
  readonly dictionary?: readonly DictionaryEntry[];
  // The firm's confirmed mapping library, read ONCE and handed in rather than looked up per field: a
  // court form with two hundred fields must not cost two hundred queries, which is the same batching
  // rule the merge context follows.
  readonly libraryMappings?: ReadonlyMap<string, string>;
  // What THIS registration's human confirmed, field name to merge key. These are the bindings that make
  // a form template fill in anything at all, and they are written back to the library in the same
  // commit as the version they bound.
  readonly confirmMappings?: readonly ConfirmedMergeFieldMapping[];
}

// The scrub, injected on the same terms the word-processing path injects the OOXML one. For a PDF it is
// the engine's own sanitizer: document metadata, embedded attachments, the XFA dataset, any values the
// uploaded form was carrying, the structure tree, bookmarks, and optional-content configuration — all
// of it removed once here rather than on every document the template produces. Returns undefined when
// the document could not be processed.
export type FormTemplateScrub = (bytes: Uint8Array) => Promise<Uint8Array | undefined>;

function failure(
  reason: FormTemplatePreparationFailureReason,
  detail: string,
  formFields: readonly FormFieldReport[] = [],
): FormTemplatePreparationResult {
  return { ok: false, reason, detail, formFields };
}

// `page 1`, or `the form` for a field the document declares but no page carries a widget for. The
// field-list surface prints a manifest field's `parts` verbatim to answer "where in the document is
// this", and for a form the answer is a page rather than an OPC part name.
function siteLabel(page: number | null): string {
  return page === null ? "the form" : `page ${page + 1}`;
}

export async function prepareFormTemplateVersion(
  uploadedBytes: Uint8Array,
  readAcroForm: AcroFormReader,
  scrub: FormTemplateScrub,
  options: FormTemplatePreparationOptions = {},
): Promise<FormTemplatePreparationResult> {
  // 1. Read the upload, so a refusal below this point can say what the document contained. A document
  //    that is not a readable PDF, and one that is a PDF with no interactive form, are refused with
  //    different sentences because they have different remedies.
  const uploaded = await readAcroForm(uploadedBytes);
  if (uploaded === undefined) {
    return failure(
      "not-a-pdf-form",
      "This file could not be read as a PDF. A form template must be a fillable PDF — the file a court or an agency publishes with boxes you can type into.",
    );
  }
  if (uploaded.length === 0) {
    return failure(
      "no-form-fields",
      "This PDF carries no fillable fields, so there is nothing for a merge to fill in. Register a fillable PDF — one whose boxes can be typed into — or register the document as a Word template instead.",
    );
  }

  // 2. Scrub, then read the BYTES THAT WILL BE STORED rather than the ones that were uploaded. The
  //    manifest has to describe the document an assembly will actually fill: a scrub that dropped the
  //    interactive form, or clearing that changed the field set, must be visible here and not at
  //    assembly time.
  //
  //    A THROW IS NOT A REFUSAL AND IS NOT CAUGHT. The seam reports "this document could not be
  //    processed" by returning undefined; a throw means the engine behind it did not run at all, which
  //    is a fact about the deployment rather than about the firm's document. Recording it as
  //    `scrub-failed` would tell an administrator to re-cut a form that is perfectly good. The reader
  //    above is called on the same terms, so both seams behave alike.
  const scrubbedBytes = await scrub(uploadedBytes);
  if (scrubbedBytes === undefined) {
    return failure(
      "scrub-failed",
      "The document's metadata, attachments, and existing entries could not be removed, so it cannot be stored as a template.",
    );
  }

  const stored = await readAcroForm(scrubbedBytes);
  if (stored === undefined || stored.length === 0) {
    return failure(
      "scrub-failed",
      "Removing the document's metadata and attachments also removed its fillable fields, so the stored template would fill nothing in.",
    );
  }

  // 3. Bindings. A field binds ONLY through a confirmed mapping — this request's, or one the firm
  //    confirmed earlier. A field name that happens to be spelled like a merge key binds NOTHING; it is
  //    offered as a proposal and waits for a person. That is the rule the whole mapping library exists
  //    to hold, and the reason it holds for an exact match as well as a near one is that a confirmed
  //    mapping is the firm's statement about its own document, and the platform has no standing to make
  //    that statement on its behalf.
  const requested = new Map<string, string>();
  for (const mapping of options.confirmMappings ?? []) {
    if (mapping.fieldName !== "" && mapping.mergeKey !== "") {
      requested.set(mapping.fieldName, mapping.mergeKey);
    }
  }
  const library = options.libraryMappings ?? new Map<string, string>();

  const reports: FormFieldReport[] = [];
  const sitesByKey = new Map<string, ManifestFormFieldSite[]>();
  const pagesByKey = new Map<string, Set<string>>();
  const unbound: UnboundFormField[] = [];

  for (const reading of stored) {
    const kind = classifyFormFieldKind(reading.kind);
    const options_ = [...reading.options];
    const frozenText =
      reading.value === null
        ? ""
        : typeof reading.value === "boolean"
          ? reading.value
            ? "ticked"
            : ""
          : reading.value;

    const record = (
      mergeKey: string,
      boundFromLibrary: boolean,
      proposedMergeKey: string,
      unboundReason: UnboundFormFieldReason | null,
    ): void => {
      reports.push({
        fieldName: reading.name,
        kind,
        page: reading.page,
        required: reading.required,
        options: options_,
        mergeKey,
        boundFromLibrary,
        proposedMergeKey,
        unboundReason,
      });
      if (unboundReason !== null) {
        unbound.push({
          fieldName: reading.name,
          kind,
          page: reading.page,
          required: reading.required,
          reason: unboundReason,
          proposedMergeKey,
          frozenText,
        });
      }
    };

    if (kind === "unclassified") {
      record("", false, "", "unclassified");
      continue;
    }
    if (!isFillableFormFieldKind(kind)) {
      record("", false, "", "not-fillable");
      continue;
    }

    const confirmedKey = requested.get(reading.name) ?? library.get(reading.name);
    if (confirmedKey === undefined) {
      // A PROPOSAL, NOT A BINDING, and only where the form's own field name IS a merge key the firm
      // has — exact, character for character. Nothing resembling anything is ever proposed: a
      // `ClientName` that becomes `client.displayName` because it looked close is a silent binding
      // decision on privileged content, and a proposal built on resemblance would be the same decision
      // wearing a confirmation dialog.
      const exact = lookupDictionaryEntry(reading.name, options.dictionary);
      record("", false, exact === undefined ? "" : exact.key, "no-confirmed-mapping");
      continue;
    }

    const entry = lookupDictionaryEntry(confirmedKey, options.dictionary);
    if (entry === undefined) {
      record(confirmedKey, !requested.has(reading.name), "", "no-confirmed-mapping");
      return failure(
        "binding-names-unknown-field",
        `"${reading.name}" is bound to ${confirmedKey}, which is not a merge field this firm has. Choose a field from the merge-field list, or remove the binding and leave the box to be filled in by hand.`,
        [...reports].sort(readingOrder),
      );
    }

    record(entry.key, !requested.has(reading.name), "", null);
    const sites = sitesByKey.get(entry.key) ?? [];
    sites.push({
      fieldName: reading.name,
      kind,
      page: reading.page,
      required: reading.required,
      options: options_,
    });
    sitesByKey.set(entry.key, sites);
    const pages = pagesByKey.get(entry.key) ?? new Set<string>();
    pages.add(siteLabel(reading.page));
    pagesByKey.set(entry.key, pages);
  }

  // 4. The manifest, in the shape a Word registration produces. One entry per DISTINCT merge key, its
  //    occurrence count the number of boxes it fills — the same denominator a Word manifest's is — and
  //    the sites recorded beside it so the fill pass plans from the manifest rather than re-reading the
  //    document.
  const fields: ManifestField[] = [...sitesByKey.entries()]
    .map(([key, sites]): ManifestField => {
      const bySite = [...sites].sort((left, right) =>
        left.fieldName.localeCompare(right.fieldName),
      );
      return {
        key,
        // A form field carries no per-placeholder format override: there is nowhere on a PDF widget to
        // write one, so the dictionary entry's default rendering is what every box gets.
        format: null,
        occurrences: bySite.length,
        parts: [...(pagesByKey.get(key) ?? new Set<string>())].sort(),
        forms: ["acroForm"],
        formFields: bySite,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));

  const manifest: FieldManifest = {
    fields,
    totalOccurrences: fields.reduce((total, field) => total + field.occurrences, 0),
    // A form template carries none of the three word-processing constructs by construction, and no
    // blocks or computed fields: there is nowhere in a PDF widget to write a condition, a repeat, or a
    // calculation, and this pass has no mechanism to record one.
    unconvertedMergeFields: [],
    legacyFormFields: [],
    unboundContentControls: [],
    unboundFormFields: [...unbound].sort((left, right) =>
      left.fieldName.localeCompare(right.fieldName),
    ),
    blocks: [],
    computedFields: [],
  };

  return {
    ok: true,
    preparation: {
      bytes: scrubbedBytes,
      manifest,
      warnings: formTemplateWarnings(manifest),
      // Only what THIS request confirmed goes back to the library. A binding that came from the library
      // is already there, and re-writing it would bump its applied count for a registration that
      // confirmed nothing.
      confirmedMergeFieldMappings: reports
        .filter((report) => report.mergeKey !== "" && !report.boundFromLibrary)
        .map((report) => ({ fieldName: report.fieldName, mergeKey: report.mergeKey }))
        // By field name, not by the order the engine happened to walk the field tree: what an
        // administrator reads back has to be stable across two registrations of the same form, and a
        // depth-first walk order is neither stable nor meaningful to them.
        .sort((left, right) => left.fieldName.localeCompare(right.fieldName)),
      formFields: [...reports].sort(readingOrder),
    },
  };
}

// Down the pages, then by name. A field the form declares that no page carries a widget for sorts last:
// there is nowhere to look for it, so it belongs at the end rather than at the top.
function readingOrder(left: FormFieldReport, right: FormFieldReport): number {
  const leftPage = left.page ?? Number.MAX_SAFE_INTEGER;
  const rightPage = right.page ?? Number.MAX_SAFE_INTEGER;
  return leftPage === rightPage
    ? left.fieldName.localeCompare(right.fieldName)
    : leftPage - rightPage;
}

// What a registered form template tells its administrator. Both warnings are about the same failure the
// three word-processing ones are — a box the merge leaves empty, in a document that otherwise reads as
// finished — so they are worded to name the box, what it prints, and the one repair.
export function formTemplateWarnings(manifest: FieldManifest): readonly NormalizationWarning[] {
  const warnings: NormalizationWarning[] = [];

  // THE TEMPLATE THAT BINDS NOTHING SAYS SO, FIRST. A form whose every field is unbound produces the
  // same document from every matter, which is a template that does not work rather than a template with
  // a gap — and it is the exact shape of the two failures the platform has already been bitten by.
  if (manifest.fields.length === 0) {
    warnings.push({
      code: "no-placeholders",
      part: "",
      detail:
        `This form has ${manifest.unboundFormFields.length} field${manifest.unboundFormFields.length === 1 ? "" : "s"} and none of them is bound to a merge field,` +
        " so every document assembled from it is the blank form. Confirm which merge field each box" +
        " should be filled from.",
    });
  }

  const byReason = (reason: UnboundFormFieldReason): readonly UnboundFormField[] =>
    manifest.unboundFormFields.filter((field) => field.reason === reason);

  const names = (fields: readonly UnboundFormField[]): string =>
    fields
      .map((field) => `"${field.fieldName}"`)
      .sort()
      .join(", ");

  const unconfirmed = byReason("no-confirmed-mapping");
  if (unconfirmed.length > 0 && manifest.fields.length > 0) {
    const proposed = unconfirmed.filter((field) => field.proposedMergeKey !== "");
    warnings.push({
      code: "unbound-form-field",
      part: "",
      detail:
        `${unconfirmed.length} box${unconfirmed.length === 1 ? "" : "es"} on this form ${unconfirmed.length === 1 ? "is" : "are"} not bound to a merge field: ` +
        `${names(unconfirmed)}. Every document assembled from this template leaves ${unconfirmed.length === 1 ? "it" : "them"} empty` +
        ` for someone to fill in by hand${proposed.length === 0 ? "" : `. ${proposed.length} of them ${proposed.length === 1 ? "is" : "are"} named exactly like a merge field this firm has, which you can confirm rather than choose`}.`,
    });
  }

  const unclassified = byReason("unclassified");
  if (unclassified.length > 0) {
    warnings.push({
      code: "unbound-form-field",
      part: "",
      detail:
        `${unclassified.length} box${unclassified.length === 1 ? "" : "es"} on this form ${unclassified.length === 1 ? "does" : "do"} not say what kind of field ${unclassified.length === 1 ? "it is" : "they are"}: ` +
        `${names(unclassified)}. Nothing is filled into ${unclassified.length === 1 ? "it" : "them"} — writing an answer into a box whose type nobody established would print as a` +
        " completed entry. Re-save the form from the tool that produced it, or fill these in by hand.",
    });
  }

  // A push button or a signature field is NOT warned about. Neither is a hole a merge could ever close:
  // a button carries an action and a signature field is filled by a signing ceremony, so a warning on
  // every form that has one is a warning a firm learns to skip past — the same reason a filled content
  // control is deliberately silent. Both are still on `unboundFormFields`, so the field set the
  // manifest reports is the field set the form has.

  return warnings;
}
