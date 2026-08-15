import {
  macroContentFindings,
  macroResidue,
  stripMacros,
  type MacroResidueFinding,
} from "./macros.ts";
import { packageIntegrityViolations } from "./assemble.ts";
import {
  normalizeTemplate,
  type ConfirmedMergeFieldMapping,
  type NormalizationFailure,
  type NormalizeOptions,
} from "./normalize.ts";
import { readPackage, writePackage } from "./ooxml/package.ts";
import type {
  FieldManifest,
  LegacyFormField,
  MergeFieldDetection,
  NormalizationWarning,
  UnboundContentControl,
} from "./types.ts";

// The registration pipeline, in the one order that is defensible.
//
// A template is an untrusted upload that will be executed against privileged firm and client data, so it
// is made safe BEFORE it is made useful, and the safety check is re-run over the bytes that are actually
// stored rather than over an intermediate the stripper vouched for. Macro stripping, normalization, and
// the metadata scrub each rewrite the package; only the last of them produces the version's bytes, and
// only those bytes are verified.
//
// BOTH transforms of the firm's own document are opt-in, and both are always reported. Detection runs
// unconditionally either way — what a template contains is stated whatever is done about it — but
// neither the macro strip nor the merge-field conversion rewrites a firm's uploaded document without an
// explicit request. Where they differ is what happens without the opt-in: an unconverted merge field is
// RECORDED ON THE MANIFEST and the template registers, because the field is then visible to every reader
// downstream; a live macro is REFUSED, because there is no way to record executable code that makes it
// safe to store, and the only two honest answers are "strip it" and "upload a macro-free file".
//
// A legacy Word form field is a THIRD case with no transform at all: nothing binds one and no opt-in
// converts one, because the only name it carries is a Word-minted bookmark and deriving a merge key
// from that would be a guess at what the firm's document means. So it is detected and reported —
// registration, the field list, and every assembly — and left exactly where it is. See normalize.ts.
//
// An unfilled CONTENT CONTROL is the fourth, and rides the third's path exactly: detected, reported at
// every surface, never rewritten. What differs is only the argument for the refusal to convert, which
// normalize.ts writes out — a control carries an author's own alias and tag, so the missing thing is a
// human's confirmation of what that name means, not evidence.
//
// Everything expensive here runs ONCE per template version, at the moment a human is looking at the
// result — never on the assembly path, where a user is waiting and a failure is least actionable.

export type TemplatePreparationFailureReason =
  | "oversize"
  | "decompression-bomb"
  | "not-a-package"
  | "not-a-word-package"
  | "macro-consent-required"
  | "macro-residue"
  | "normalization-failed"
  | "scrub-failed"
  | "package-integrity";

export interface TemplatePreparation {
  // The bytes to store as the template version. Normalized, macro-free, and scrubbed.
  readonly bytes: Uint8Array;
  readonly manifest: FieldManifest;
  readonly warnings: readonly NormalizationWarning[];
  readonly normalizerVersion: number;
  // The macro payloads removed from the upload, by part name. Empty for the ordinary case; a non-empty
  // list is what the registration response tells the administrator was taken out of their template.
  readonly removedMacroParts: readonly string[];
  // Whether the strip was asked for and ran. False with an empty removal list is the ordinary case (the
  // upload had nothing to strip); true with an empty list means the strip was requested and found
  // nothing, which is a different fact and worth reporting as one.
  readonly macrosStripped: boolean;
  // Every Word merge field found in the upload, and whether they were converted. Reported back to the
  // caller whichever way the opt-in went: a firm is told what its document contained and what happened
  // to it, never left to discover a silent rewrite.
  readonly mergeFieldDetections: readonly MergeFieldDetection[];
  readonly mergeFieldsConverted: boolean;
  // The legacy Word form fields the upload carries. Reported for the same reason the merge fields are,
  // and with one difference the caller must not blur: there is no opt-in that binds these, so the only
  // remedies are to replace them in Word or to file the document knowing where its blanks are.
  readonly legacyFormFields: readonly LegacyFormField[];
  // The content controls the upload carries that nothing will fill in. Same standing as the line above:
  // reported so the firm knows where its document has holes, with no opt-in that closes them.
  readonly unboundContentControls: readonly UnboundContentControl[];
  // The name-to-key mappings this registration confirmed, for the firm's mapping library. Empty unless
  // conversion ran.
  readonly confirmedMergeFieldMappings: readonly ConfirmedMergeFieldMapping[];
}

export type TemplatePreparationResult =
  | { readonly ok: true; readonly preparation: TemplatePreparation }
  | {
      readonly ok: false;
      readonly reason: TemplatePreparationFailureReason;
      readonly detail: string;
      readonly normalizationFailures: readonly NormalizationFailure[];
      readonly macroFindings: readonly MacroResidueFinding[];
      // Reported on a REFUSAL too, and especially then: a registration refused because the document
      // uses Word merge fields is refused with the list of them, so the caller can present the choice
      // (convert, or edit the document) rather than a dead end.
      readonly mergeFieldDetections: readonly MergeFieldDetection[];
      // Likewise on a refusal: a template refused for an authoring mistake elsewhere still tells the
      // firm which of its fields nothing will bind, rather than saving that up for the attempt that
      // finally passes.
      readonly legacyFormFields: readonly LegacyFormField[];
      readonly unboundContentControls: readonly UnboundContentControl[];
      readonly macroProjectFound: boolean;
    };

function failure(
  reason: TemplatePreparationFailureReason,
  detail: string,
  extras: {
    normalizationFailures?: readonly NormalizationFailure[];
    macroFindings?: readonly MacroResidueFinding[];
    mergeFieldDetections?: readonly MergeFieldDetection[];
    legacyFormFields?: readonly LegacyFormField[];
    unboundContentControls?: readonly UnboundContentControl[];
    macroProjectFound?: boolean;
  } = {},
): TemplatePreparationResult {
  return {
    ok: false,
    reason,
    detail,
    normalizationFailures: extras.normalizationFailures ?? [],
    macroFindings: extras.macroFindings ?? [],
    mergeFieldDetections: extras.mergeFieldDetections ?? [],
    legacyFormFields: extras.legacyFormFields ?? [],
    unboundContentControls: extras.unboundContentControls ?? [],
    macroProjectFound: extras.macroProjectFound ?? false,
  };
}

// The metadata scrub, injected rather than imported, so this package stays free of the inspector's
// engine selection and so a test can drive the pipeline without a scrub. Returns the scrubbed bytes, or
// undefined when the scrub could not process the package at all.
export type TemplateScrub = (bytes: Uint8Array) => Promise<Uint8Array | undefined>;

export interface TemplatePreparationOptions extends NormalizeOptions {
  // OPT-IN, exactly like convertMergeFields and for the same reason: removing the macro project
  // rewrites the firm's own document, and a product that rewrites uploads unasked is one a firm cannot
  // predict. Absent or false: a macro-bearing upload is REFUSED with both remedies named. True: every
  // payload is removed, the declarations that referenced it are repaired, and the result is
  // independently re-verified before it may be stored.
  readonly stripMacros?: boolean;
}

export async function prepareTemplateVersion(
  uploadedBytes: Uint8Array,
  scrub: TemplateScrub,
  options: TemplatePreparationOptions = {},
): Promise<TemplatePreparationResult> {
  const read = readPackage(uploadedBytes);
  if (!read.ok) return failure(read.reason, read.detail);

  // 1. The macro consent gate. Detection always runs; what may be DONE about it is the firm's call, and
  //    without the opt-in there is no third option — a template carrying live macros is never stored,
  //    because it would be executed against privileged client data, and it is never silently stripped,
  //    because that is a rewrite of the firm's document. So the refusal names both remedies.
  const uploadMacroFindings = macroContentFindings(read.value);
  const macroProjectFound = uploadMacroFindings.length > 0;
  const strip = options.stripMacros === true;
  if (macroProjectFound && !strip) {
    return failure(
      "macro-consent-required",
      "This document carries macro content, which cannot be stored as a template: a template is run against privileged client data, and code inside one would run with it. Register again asking for the macros to be removed — the document stored will then not be the document uploaded — or upload a macro-free copy of the file.",
      { macroFindings: uploadMacroFindings, macroProjectFound },
    );
  }

  // 2. Strip every macro payload and repair the declarations that referenced it, then re-emit and
  //    re-read: a stripper that leaves the package unreadable has not made it safe, it has made it
  //    broken, and the difference has to be visible here rather than at assembly time.
  const stripped = strip ? stripMacros(read.value) : { parts: read.value, removedParts: [] };
  const strippedRead = strip ? readPackage(writePackage(stripped.parts)) : read;
  if (!strippedRead.ok) {
    return failure(
      strippedRead.reason,
      `the package could not be re-read after macro removal: ${strippedRead.detail}`,
      { macroProjectFound },
    );
  }

  // 3. Normalize: reassemble run-split placeholders, DETECT Word merge fields (converting them only if
  //    the caller opted in, and otherwise recording each on the manifest with the frozen text it will
  //    render), and record the field manifest. Failures carry locations so the field inspector can point
  //    at the authoring mistake.
  const normalized = normalizeTemplate(strippedRead.value, options);
  if (normalized.failures.length > 0) {
    return failure(
      "normalization-failed",
      `${normalized.failures.length} placeholder problem${normalized.failures.length === 1 ? "" : "s"} must be fixed before this template can be registered`,
      {
        normalizationFailures: normalized.failures,
        mergeFieldDetections: normalized.mergeFieldDetections,
        legacyFormFields: normalized.legacyFormFields,
        unboundContentControls: normalized.unboundContentControls,
        macroProjectFound,
      },
    );
  }

  // 4. Scrub the normalized package: a filed document must not carry the drafting history of the
  //    template it came from, and doing it once here is strictly better than doing it on every output.
  const normalizedBytes = writePackage(normalized.parts);
  let scrubbedBytes: Uint8Array | undefined;
  try {
    scrubbedBytes = await scrub(normalizedBytes);
  } catch {
    scrubbedBytes = undefined;
  }
  if (scrubbedBytes === undefined) {
    return failure("scrub-failed", "the template's drafting history could not be removed", {
      mergeFieldDetections: normalized.mergeFieldDetections,
      legacyFormFields: normalized.legacyFormFields,
      unboundContentControls: normalized.unboundContentControls,
      macroProjectFound,
    });
  }

  // 5. Verify THE BYTES THAT WILL BE STORED. This is a second, independent scan rather than a flag the
  //    stripper set: the stripper asserting its own success is exactly the failure mode this gate
  //    exists to catch, and the scrub in between could in principle have re-declared a content type the
  //    strip removed. A template version whose stored bytes show any macro residue never registers —
  //    which is also what stops a macro-free-looking upload that the scrub turned macro-bearing.
  const finalRead = readPackage(scrubbedBytes);
  if (!finalRead.ok) {
    return failure(finalRead.reason, `the scrubbed package is unreadable: ${finalRead.detail}`, {
      macroProjectFound,
    });
  }
  const residue = macroResidue(finalRead.value);
  if (residue.length > 0) {
    return failure(
      "macro-residue",
      "the template still carries macro content after removal and cannot be registered",
      { macroFindings: residue, macroProjectFound },
    );
  }
  const violations = packageIntegrityViolations(finalRead.value);
  if (violations.length > 0) {
    return failure("package-integrity", violations.join("; "), { macroProjectFound });
  }

  return {
    ok: true,
    preparation: {
      bytes: scrubbedBytes,
      manifest: normalized.manifest,
      warnings: normalized.warnings,
      normalizerVersion: normalized.normalizerVersion,
      removedMacroParts: stripped.removedParts,
      macrosStripped: strip,
      mergeFieldDetections: normalized.mergeFieldDetections,
      legacyFormFields: normalized.legacyFormFields,
      unboundContentControls: normalized.unboundContentControls,
      mergeFieldsConverted: options.convertMergeFields === true,
      confirmedMergeFieldMappings: normalized.confirmedMappings,
    },
  };
}
