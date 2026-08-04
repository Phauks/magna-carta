import { macroResidue, stripMacros, type MacroResidueFinding } from "./macros.ts";
import { packageIntegrityViolations } from "./assemble.ts";
import {
  normalizeTemplate,
  type NormalizationFailure,
  type NormalizeOptions,
} from "./normalize.ts";
import { readPackage, writePackage } from "./ooxml/package.ts";
import type { FieldManifest, MergeFieldDetection, NormalizationWarning } from "./types.ts";

// The registration pipeline, in the one order that is defensible.
//
// A template is an untrusted upload that will be executed against privileged firm and client data, so it
// is made safe BEFORE it is made useful, and the safety check is re-run over the bytes that are actually
// stored rather than over an intermediate the stripper vouched for. Macro stripping, normalization, and
// the metadata scrub each rewrite the package; only the last of them produces the version's bytes, and
// only those bytes are verified.
//
// Everything expensive here runs ONCE per template version, at the moment a human is looking at the
// result — never on the assembly path, where a user is waiting and a failure is least actionable.

export type TemplatePreparationFailureReason =
  | "oversize"
  | "decompression-bomb"
  | "not-a-package"
  | "not-a-word-package"
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
  // Every Word merge field found in the upload, and whether they were converted. Reported back to the
  // caller whichever way the opt-in went: a firm is told what its document contained and what happened
  // to it, never left to discover a silent rewrite.
  readonly mergeFieldDetections: readonly MergeFieldDetection[];
  readonly mergeFieldsConverted: boolean;
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
      readonly macroProjectFound: boolean;
    };

function failure(
  reason: TemplatePreparationFailureReason,
  detail: string,
  extras: {
    normalizationFailures?: readonly NormalizationFailure[];
    macroFindings?: readonly MacroResidueFinding[];
    mergeFieldDetections?: readonly MergeFieldDetection[];
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
    macroProjectFound: extras.macroProjectFound ?? false,
  };
}

// The metadata scrub, injected rather than imported, so this package stays free of the inspector's
// engine selection and so a test can drive the pipeline without a scrub. Returns the scrubbed bytes, or
// undefined when the scrub could not process the package at all.
export type TemplateScrub = (bytes: Uint8Array) => Promise<Uint8Array | undefined>;

export async function prepareTemplateVersion(
  uploadedBytes: Uint8Array,
  scrub: TemplateScrub,
  options: NormalizeOptions = {},
): Promise<TemplatePreparationResult> {
  const read = readPackage(uploadedBytes);
  if (!read.ok) return failure(read.reason, read.detail);

  // 1. Strip every macro payload and repair the declarations that referenced it, then re-emit and
  //    re-read: a stripper that leaves the package unreadable has not made it safe, it has made it
  //    broken, and the difference has to be visible here rather than at assembly time.
  const stripped = stripMacros(read.value);
  const macroProjectFound = stripped.removedParts.length > 0;
  const strippedRead = readPackage(writePackage(stripped.parts));
  if (!strippedRead.ok) {
    return failure(
      strippedRead.reason,
      `the package could not be re-read after macro removal: ${strippedRead.detail}`,
      { macroProjectFound },
    );
  }

  // 2. Normalize: reassemble run-split placeholders, DETECT Word merge fields (and convert them only if
  //    the caller opted in), and record the field manifest. Failures carry locations so the field
  //    inspector can point at the authoring mistake.
  const normalized = normalizeTemplate(strippedRead.value, options);
  if (normalized.failures.length > 0) {
    return failure(
      "normalization-failed",
      `${normalized.failures.length} placeholder problem${normalized.failures.length === 1 ? "" : "s"} must be fixed before this template can be registered`,
      {
        normalizationFailures: normalized.failures,
        mergeFieldDetections: normalized.mergeFieldDetections,
        macroProjectFound,
      },
    );
  }

  // 3. Scrub the normalized package: a filed document must not carry the drafting history of the
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
      macroProjectFound,
    });
  }

  // 4. Verify THE BYTES THAT WILL BE STORED. This is a second, independent scan rather than a flag the
  //    stripper set: the stripper asserting its own success is exactly the failure mode this gate
  //    exists to catch, and the scrub in between could in principle have re-declared a content type the
  //    strip removed. A template version whose stored bytes show any macro residue never registers.
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
      mergeFieldDetections: normalized.mergeFieldDetections,
      mergeFieldsConverted: options.convertMergeFields === true,
    },
  };
}
