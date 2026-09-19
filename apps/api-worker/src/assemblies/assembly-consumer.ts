import { type EngineResolver, runConversion } from "@magna-carta/conversion/execute";
import { commitEffectBatch, guarded } from "@magna-carta/data-access/effect-batch";
import { assemble } from "@magna-carta/document-assembly/assemble";
import {
  completeDocumentAssemblyStatement,
  failDocumentAssemblyStatement,
  markAssemblyRunningStatement,
  readDocumentAssembly,
} from "@magna-carta/document-assembly/assembly-statements";
import { customFieldDictionaryEntries } from "@magna-carta/document-assembly/custom-field-bindings";
import {
  dictionaryForFirm,
  lookupDictionaryEntry,
} from "@magna-carta/document-assembly/dictionary";
import {
  readCustomFieldCatalog,
  resolveMergeContext,
} from "@magna-carta/document-assembly/resolve";
import { selectMatterEstateDateOfDeathStatement } from "@magna-carta/document-assembly/merge-statements";
import { readTemplateVersionForAssembly } from "@magna-carta/document-assembly/template-statements";
import { assetSubjectsIn } from "@magna-carta/document-assembly/asset-bindings";
import { contentControlLabel } from "@magna-carta/document-assembly/normalize";
import { fillFormTemplate } from "@magna-carta/document-assembly/fill-form";
import type { AssemblyAbsence } from "@magna-carta/document-assembly/assemble";
import { manifestKeys, type FieldManifest } from "@magna-carta/document-assembly/types";
import type { ProtectedIdentifierReader } from "@magna-carta/document-assembly/protected-bindings";
import { readIdentifier } from "@magna-carta/directory/identifiers";
import { completeUploadSession, initiateUpload } from "@magna-carta/file-manager/file-service";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  DocumentAssemblyId,
  DocumentTemplateVersionId,
  FirmId,
  FolderId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { documentAssembled } from "@magna-carta/telemetry/events";
import {
  documentAssemblyAbsentField,
  documentAssemblyExpression,
  documentAssemblyFrozenField,
  documentAssemblyJobs,
} from "@magna-carta/telemetry/metrics";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../bindings.ts";
import { resolveEnginePort } from "../conversions/conversion-engine.ts";
import { fillAcroForm, FILLED_FORM_FINISH } from "./pdf-form-engine.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";
import { loadEffectivePermissions } from "../session-context.ts";
import type { DocumentAssemblyMessage } from "./assembly-types.ts";

// The assembly consumer: read the template version's bytes, resolve the merge context through the
// firm-scoped data-access layer, assemble, and file the output.
//
// TWO ENGINES, ONE JOB. The job branches on the template version's KIND, and it branches in exactly one
// place: everything before the branch — the version read, the gate check, the byte read and its cache,
// the manifest, the dictionary the firm has today, the batched merge-context resolution, and the
// protected-field chokepoint — runs identically and does not know which kind it served. A
// `wordProcessing` version goes through the OOXML assembler; a `pdfForm` version goes through the PDF
// engine's AcroForm filler. Everything after the branch — the absence accounting, the frozen-field list,
// the ingest chokepoint, the provenance row, and the telemetry — is shared again, which is what keeps
// the two kinds honest about producing the same KIND of answer.
//
// THE OUTPUT ENTERS THE NORMAL FILE PIPELINE, SCAN INCLUDED. The tempting shortcut is to commit a
// server-generated version directly as `clean`, since we produced the bytes. It is refused: the moment
// there are two ways for a version to reach `clean`, the invariant that every file_version read filters
// on status stops being enforceable by construction, and the second path is the one that will be wrong.
// initiateUpload / completeUploadSession plus the ingest event is the one entrance, the same one the
// email-filing attachment path uses.
//
// A job asked for a PDF carries the merged package across the SAME conversion edge the file-converter
// tool uses — the registry's docx-to-pdf hop, executed by whichever service resolveEnginePort names for
// its engine. There is no second conversion path here and no engine of this subsystem's own: the merge
// produces a word-processing package and the office suite turns it into a PDF, which is the one job
// that suite has (packages/conversion/src/registry.ts holds the edge).
//
// The stage names are the telemetry dimension for where a job ends, so they are a closed set here.
type AssemblyStage =
  | "load-template"
  | "read-bytes"
  | "resolve"
  | "merge"
  | "fill"
  | "convert"
  | "file"
  | "done";

// What each output format is, once. The name a filed document takes, and the content type the ingest
// gate is told to expect, both follow from the format rather than being written out at each use.
const OUTPUT_FORMATS = {
  docx: {
    extension: "docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  pdf: { extension: "pdf", contentType: "application/pdf" },
} as const;

type AssemblyOutputFormat = keyof typeof OUTPUT_FORMATS;

// Failure reasons are a closed set of CODES. A merge failure reports WHICH KEY failed (on the assembly
// row's absent-key column), never what it held, and never the value of any field that did resolve.
type AssemblyFailureCode =
  | "assembly-not-found"
  | "template-version-not-found"
  | "template-not-activatable"
  | "template-bytes-missing"
  | "template-unreadable"
  | "matter-not-found"
  | "merge-field-unresolvable"
  // An expression the stored template carries no longer checks against the dictionary the firm has
  // today, or could not produce a value from data that all resolved. Both fail the assembly rather
  // than choosing a branch: a missing clause is invisible, because nobody reads a contract and
  // notices the paragraph that is not there.
  | "template-expression-invalid"
  | "assembly-expression-refused"
  | "package-integrity"
  // The merged package could not be turned into a PDF. The reason is the conversion port's own typed
  // code, not a second vocabulary: `engine-not-implemented` means the office suite is not reachable
  // from this deployment yet, and everything else means the edge ran and refused these bytes. Neither
  // files a word-processing package instead — a member who asked for a PDF and silently got a `.docx`
  // finds out when they try to sign it.
  | "conversion-failed"
  // A form template could not be filled: the stored PDF would not open, or the engine refused it. The
  // same shape `template-unreadable` has on the word-processing side, named separately so a firm reading
  // the failure knows which engine could not read its document.
  | "form-fill-failed"
  // The job asked for an output format the template's kind cannot produce — a word-processing document
  // out of a fillable PDF. The submit route refuses this while the caller can act on the answer; the
  // code exists because the consumer must not silently file the other format instead.
  | "output-format-unavailable"
  | "assembly-error";

// An isolate-level cache of template bytes, safe because a template version is immutable: the key pins
// both the version handle and the content hash, so a cache hit can only ever be the same bytes. A busy
// firm's letterhead template is therefore fetched from R2 rarely rather than once per document.
const TEMPLATE_CACHE_LIMIT = 8;
const templateBytesCache = new Map<string, Uint8Array>();

function cacheTemplateBytes(key: string, bytes: Uint8Array): void {
  if (templateBytesCache.has(key)) templateBytesCache.delete(key);
  templateBytesCache.set(key, bytes);
  while (templateBytesCache.size > TEMPLATE_CACHE_LIMIT) {
    const oldest = templateBytesCache.keys().next().value;
    if (oldest === undefined) break;
    templateBytesCache.delete(oldest);
  }
}

function coordinatorFor(env: Bindings, message: DocumentAssemblyMessage) {
  return env.DOCUMENT_ASSEMBLY_JOB.get(
    env.DOCUMENT_ASSEMBLY_JOB.idFromName(`${message.firmId}:${message.assemblyId}`),
  );
}

// How this job reads a sealed identifier: the directory's own `readIdentifier`, which is the protected-
// field chokepoint — the permission gate, the decrypt-audit row committed before any plaintext, and the
// AAD-bound decrypt. Assembly gets no second door to a protected column; it gets this one.
//
// THE PERMISSIONS ARE RE-DERIVED HERE, NOT CARRIED ON THE MESSAGE. A queued job runs after the request
// that submitted it, and the question the gate answers is whether this member may decrypt NOW — a
// permission revoked between submit and consume has to bite. Carrying a decided answer on the message
// would be a grant with no expiry travelling through a queue, which is the one thing an authorization
// decision must never become. The message carries the member's identity; the firm's database supplies
// what that identity may do.
//
// The permission read is DEFERRED to the first protected key: a template that binds none never issues
// it, so the ordinary assembly costs exactly what it did before.
//
// A job with no requesting member decrypts nothing. There is no member to gate, and "nobody" is not a
// principal that may hold a permission — those keys land on the declared absence instead.
function protectedIdentifierReaderFor(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  firmId: FirmId,
  requestedBy: UserId | null,
): ProtectedIdentifierReader | undefined {
  if (requestedBy === null) return undefined;
  let context: Promise<Parameters<typeof readIdentifier>[0]> | undefined;
  return async (entityId, identifierType) => {
    context ??= loadEffectivePermissions(firmDatabase, requestedBy).then(
      (effectivePermissions) => ({
        firmId,
        // The only firm key version minted today; the directory route resolves it the same way.
        firmKeyVersion: 1,
        firmKeyProvider: firmKeyProviderForEnv(env),
        database: firmDatabase,
        effectivePermissions,
        actorUserId: requestedBy,
        clock: { now: () => new Date().toISOString() },
        randomSource: cryptoRandomSource,
      }),
    );
    return readIdentifier(await context, entityId, identifierType);
  };
}

function parseManifest(json: string): FieldManifest {
  try {
    const parsed = JSON.parse(json) as Partial<FieldManifest>;
    return {
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
      totalOccurrences: typeof parsed.totalOccurrences === "number" ? parsed.totalOccurrences : 0,
      unconvertedMergeFields: Array.isArray(parsed.unconvertedMergeFields)
        ? parsed.unconvertedMergeFields
        : [],
      // Absent on a manifest stored before legacy form fields were detected. Re-registering the
      // template is what makes them reportable, since a template version's manifest is immutable.
      legacyFormFields: Array.isArray(parsed.legacyFormFields) ? parsed.legacyFormFields : [],
      // Likewise absent on a manifest stored before content controls were looked at at all.
      unboundContentControls: Array.isArray(parsed.unboundContentControls)
        ? parsed.unboundContentControls
        : [],
      // Empty on every word-processing manifest, and on a form manifest only when every box on the form
      // is bound. Absent altogether on a manifest stored before form templates existed, which is a
      // word-processing one by construction.
      unboundFormFields: Array.isArray(parsed.unboundFormFields) ? parsed.unboundFormFields : [],
      // Absent on a manifest stored before blocks and computed fields existed, which is a template
      // that carried neither. The read plans its batched reads from the keys these carry, so an
      // older manifest simply asks for fewer.
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      computedFields: Array.isArray(parsed.computedFields) ? parsed.computedFields : [],
    };
  } catch {
    return {
      fields: [],
      totalOccurrences: 0,
      unconvertedMergeFields: [],
      legacyFormFields: [],
      unboundContentControls: [],
      unboundFormFields: [],
      blocks: [],
      computedFields: [],
    };
  }
}

// The produced document's name: the template's name plus the matter's number, so a member looking at a
// matter's file list can tell two assemblies of the same template on different matters apart. Path
// separators and control characters are stripped — a template name is firm-authored text and the file
// name it becomes has to be a name, not a path.
export function assembledDocumentName(
  templateName: string,
  matterLabel: string,
  outputFormat: AssemblyOutputFormat = "docx",
): string {
  const clean = (value: string): string =>
    // eslint-disable-next-line no-control-regex -- the C0 range is exactly what has to go from a name
    value
      .replace(/[\u0000-\u001f/\\:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const base = [clean(templateName), clean(matterLabel)].filter((part) => part !== "").join(" - ");
  return `${base === "" ? "Assembled document" : base}.${OUTPUT_FORMATS[outputFormat].extension}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface AssemblyFailure {
  readonly code: AssemblyFailureCode;
  readonly stage: AssemblyStage;
  readonly keys: readonly string[];
}

async function assembleOne(
  env: Bindings,
  message: DocumentAssemblyMessage,
  resolveEngines: (env: Bindings) => EngineResolver,
): Promise<AssemblyFailure | undefined> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const firmDatabase: ProxyBatchDatabase = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const assemblyId = message.assemblyId as DocumentAssemblyId;
  const matterId = message.matterId as MatterId;
  const now = (): string => new Date().toISOString();

  const assembly = await readDocumentAssembly(firmDatabase, matterId, assemblyId);
  if (assembly === undefined) {
    return { code: "assembly-not-found", stage: "load-template", keys: [] };
  }
  // A redelivered message must not file a second document. The row is the durable record of "this job
  // already produced a document"; the Durable Object's markDone is the fast path, this is the one that
  // survives a coordinator that lost its alarm.
  if (assembly.status === "done" && assembly.fileId !== null && assembly.fileVersionId !== null) {
    await coordinatorFor(env, message).markDone(assembly.fileId, assembly.fileVersionId);
    return undefined;
  }

  await coordinatorFor(env, message).markRunning();
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        guarded(markAssemblyRunningStatement(firmDatabase, assemblyId), "document-assembly.claim"),
      ],
      outboxMessages: [],
    },
    { now },
  );

  const templateVersion = await readTemplateVersionForAssembly(
    firmDatabase,
    message.templateVersionId as DocumentTemplateVersionId,
  );
  if (templateVersion === undefined) {
    return { code: "template-version-not-found", stage: "load-template", keys: [] };
  }
  // Only a version whose stored bytes cleared the ingest gate may be assembled from. The submit route
  // checked this too; re-checking here is what makes a version quarantined between submit and consume
  // stop the job rather than produce a document from bytes the scan later rejected.
  if (templateVersion.status !== "clean") {
    return { code: "template-not-activatable", stage: "load-template", keys: [] };
  }

  const { bucket, bucketName } = resolveFirmBucket(env, message.bucketName);
  const cacheKey = `${templateVersion.versionId}:${templateVersion.contentSha256 ?? ""}`;
  let templateBytes = templateBytesCache.get(cacheKey);
  if (templateBytes === undefined) {
    const object = await bucket.get(templateVersion.r2Key);
    if (object === null) {
      return { code: "template-bytes-missing", stage: "read-bytes", keys: [] };
    }
    templateBytes = new Uint8Array(await object.arrayBuffer());
    cacheTemplateBytes(cacheKey, templateBytes);
  }

  const manifest = parseManifest(templateVersion.fieldManifestJson);

  // The firm's own display name is a control-plane fact, read here rather than carried on the message —
  // the message carries identifiers only, and a firm's name is a value a document renders.
  const firmRow = await env.DB_CONTROL.prepare("SELECT name FROM firm WHERE id = ?1")
    .bind(message.firmId)
    .first<{ name: string }>();

  // The dictionary the firm has TODAY, including its own custom-field bindings — not the one it had
  // when the template registered. That difference is the point: a template bound in March to a field
  // archived in June must fail in September naming the key rather than quietly leave a hole.
  const dictionary = dictionaryForFirm(
    customFieldDictionaryEntries(await readCustomFieldCatalog(firmDatabase)),
  );

  // The date a template's asset figures speak to. For an estate that is the date of death — the
  // estate record's own fact, read here only when the template actually walks the register — and a
  // matter with no estate record (or no recorded date) falls back to the assembly's own date, a
  // schedule as of today. Supplied to the resolver rather than read inside it, because the asset
  // read needs the date before it runs and the register never invents one.
  let assetsAsOfDate: string | undefined;
  if (assetSubjectsIn(new Set(manifestKeys(manifest))).length > 0) {
    const estateRow = await selectMatterEstateDateOfDeathStatement(firmDatabase, matterId).first<{
      date_of_death: string | null;
    }>();
    if (estateRow?.date_of_death != null && estateRow.date_of_death !== "") {
      assetsAsOfDate = estateRow.date_of_death;
    }
  }

  const resolution = await resolveMergeContext(firmDatabase, {
    matterId,
    manifest,
    ...(assetsAsOfDate === undefined ? {} : { assetsAsOfDate }),
    firmName: firmRow?.name ?? "",
    assembledAt: now(),
    // The one currency the platform registers. When a firm may choose another, its setting is read here
    // — the resolver takes it as an input precisely so this stays one line at the composition root.
    currencyCode: "USD",
    dictionary,
    // The letterhead logo's bytes, from the firm's own bucket. Fetched only if the template draws one;
    // an object that has gone resolves as a reported absence rather than a lost letterhead.
    readImageAsset: async (objectKey) => {
      const object = await bucket.get(objectKey);
      return object === null ? undefined : new Uint8Array(await object.arrayBuffer());
    },
    // The one way this job can turn a sealed value back into a string. A member who may not is refused
    // by the chokepoint and the field lands on the absence model naming what they would need — the
    // document is still produced, and it shows where the value is missing.
    readProtectedIdentifier: protectedIdentifierReaderFor(
      env,
      firmDatabase,
      message.firmId as FirmId,
      (message.requestedBy as UserId | null) ?? null,
    ),
  });
  if (!resolution.ok) {
    return { code: "matter-not-found", stage: "resolve", keys: [] };
  }

  // THE MERGE CONTEXT IS RESOLVED IDENTICALLY FOR BOTH KINDS OF TEMPLATE, and only what happens to it
  // afterwards differs: a word-processing template goes through the OOXML assembler, and a form template
  // goes through the PDF engine's AcroForm filler. Everything above this line — the manifest, the read
  // plan, the batched reads, the protected-field chokepoint, the absence reasons — has already run and
  // does not know which kind it served.
  const isFormTemplate = templateVersion.kind === "pdfForm";

  // What each output format is for THIS kind of template. A merge emits a word-processing package that a
  // `pdf` job converts; a form fill emits a PDF and nothing converts it back. A job that asked for the
  // other one fails rather than filing something else under the name the member asked for.
  const outputFormat: AssemblyOutputFormat = message.outputFormat === "pdf" ? "pdf" : "docx";
  if (isFormTemplate && outputFormat !== "pdf") {
    return { code: "output-format-unavailable", stage: "fill", keys: [] };
  }

  let mergedBytes: Uint8Array;
  let absences: readonly AssemblyAbsence[];

  if (isFormTemplate) {
    const filled = await fillFormTemplate(
      templateBytes,
      resolution.context,
      manifest,
      fillAcroForm,
      {
        dictionary,
        // The one place the platform decides what a filled form IS when it is filed. See
        // pdf-form-engine.ts — the choice between interactive and flattened is the firm owner's, and
        // the parameter is explicit here so nothing can acquire a default by omission.
        finish: FILLED_FORM_FINISH,
      },
    );
    if (!filled.ok) {
      return {
        code:
          filled.reason === "missing-required-field"
            ? "merge-field-unresolvable"
            : "form-fill-failed",
        stage: "fill",
        keys: filled.keys,
      };
    }
    mergedBytes = filled.bytes;
    absences = filled.absences;
  } else {
    const merged = assemble(templateBytes, resolution.context, { dictionary });
    // How each expression site came out, counted whichever way the assembly went. No expression text, no
    // merge-field key, and no value is ever a dimension. A form template has no expression sites at all —
    // there is nowhere on a PDF widget to write a condition — so it counts none rather than counting zero.
    for (const site of merged.expressions) {
      for (let counted = 0; counted < site.count; counted += 1) {
        logger.count(documentAssemblyExpression.metricName, {
          outcome: site.outcome,
          site: site.site,
        });
      }
    }
    if (!merged.ok) {
      return {
        code:
          merged.reason === "missing-required-field"
            ? "merge-field-unresolvable"
            : merged.reason === "package-integrity"
              ? "package-integrity"
              : merged.reason === "expression-invalid"
                ? "template-expression-invalid"
                : merged.reason === "expression-refused" ||
                    merged.reason === "expression-unresolved"
                  ? "assembly-expression-refused"
                  : "template-unreadable",
        stage: "merge",
        keys: merged.keys,
      };
    }
    mergedBytes = merged.bytes;
    absences = merged.absences;
  }

  for (const absence of absences) {
    const source = lookupDictionaryEntry(absence.key, dictionary)?.source;
    if (source !== undefined) {
      // A reason means resolution knew the firm's data could not answer the question as the template
      // asked it — a Directory role with more than one candidate, say — rather than simply holding
      // nothing. The REASON TEXT is not a dimension: it counts a matter's parties, and a count of a
      // firm's own records has no business in a metric label.
      logger.count(documentAssemblyAbsentField.metricName, {
        source,
        cause: absence.reason === null ? "no-value" : "unresolvable",
      });
    }
  }

  // The Word merge fields this template still carries. Nothing substitutes them, so the produced
  // document prints the text Word last cached in each — a blank that does not look like a blank, which
  // is the one failure the absence model cannot see by looking at the merge alone. The template's
  // manifest recorded them at registration precisely so this point can report them, and an assembly
  // carrying any completes `succeeded_with_absences`: like an absence, it is a document that needs a
  // human before it is filed.
  //
  // The template's LEGACY WORD FORM FIELDS join the same list, because they are the same failure: a
  // hole nothing substitutes, printing the template's own "click here to enter text" where a person is
  // meant to have typed. They are labelled by kind as well as name, since Word mints a bookmark like
  // `Text1` and a firm's author rarely renames it — and a form field the author never named at all is
  // still a hole, so it is listed by its kind rather than dropped for want of a label.
  //
  // So do the template's UNFILLED CONTENT CONTROLS, which is the same hole in the construct Word writes
  // today: a region showing "Click here to enter text.", or one bound to data inside the template that
  // nothing here updates. Their label comes from the engine rather than being composed again here, so a
  // registration warning and this list can never name the same control two different ways.
  // sort on the freshly-mapped copy (nothing else holds it), matching the worker's TS lib target.
  const frozenFieldNames = [
    ...manifest.unconvertedMergeFields.map((field) => field.fieldName),
    ...manifest.legacyFormFields.map((field) =>
      field.fieldName === ""
        ? `unnamed Word ${field.kind} form field`
        : `${field.fieldName} (Word ${field.kind} form field)`,
    ),
    ...manifest.unboundContentControls.map(contentControlLabel),
    // A form template's UNBOUND BOXES are the same failure in the fourth construct: a field on the form
    // that no confirmed mapping fills, so the filed document has a blank where the court expects an
    // answer. A push button and a signature field are deliberately NOT listed — neither is a hole a
    // merge could ever close, and a warning every form earns is a warning a firm learns to skip past.
    ...manifest.unboundFormFields
      .filter((field) => field.reason !== "not-fillable")
      .map((field) =>
        field.reason === "unclassified"
          ? `${field.fieldName} (a form box of no stated type)`
          : `${field.fieldName} (an unbound form box)`,
      ),
  ].toSorted();
  for (const field of manifest.unconvertedMergeFields) {
    logger.count(documentAssemblyFrozenField.metricName, { form: field.form });
  }
  for (const field of manifest.legacyFormFields) {
    logger.count(documentAssemblyFrozenField.metricName, { form: `form-field-${field.kind}` });
  }
  for (const control of manifest.unboundContentControls) {
    logger.count(documentAssemblyFrozenField.metricName, {
      form: `content-control-${control.kind}`,
    });
  }
  for (const field of manifest.unboundFormFields) {
    if (field.reason === "not-fillable") continue;
    logger.count(documentAssemblyFrozenField.metricName, { form: `form-box-${field.reason}` });
  }
  const needsReview = absences.length > 0 || frozenFieldNames.length > 0;

  // The PDF arm. The merge emits a word-processing package whatever was asked for; a job asked for a
  // PDF hands those bytes to the registry's own docx-to-pdf edge and files what comes back. This is
  // deliberately the same edge and the same executing service the file-converter tool uses — the
  // office suite is the one thing in the platform that renders a word-processing package faithfully,
  // and a second path to a PDF would be a second answer to "what does this document look like".
  //
  // A refusal here FAILS THE JOB. Filing the word-processing package instead would hand a member who
  // asked for a PDF something that reads as the document they wanted and cannot be sealed; the row
  // records which of the two it was trying to make, so the failure explains itself.
  //
  // A FILLED FORM DOES NOT TAKE THIS ARM. It is already a PDF, produced by the engine that owns the
  // form's own appearances, so handing it to the office suite would re-render a document that is already
  // exactly what the court published.
  let outputBytes = mergedBytes;
  if (outputFormat === "pdf" && !isFormTemplate) {
    const converted = await runConversion("docx", "pdf", mergedBytes, resolveEngines(env));
    if (!converted.ok) {
      return { code: "conversion-failed", stage: "convert", keys: [] };
    }
    outputBytes = converted.bytes;
  }

  // The matter number labels the produced document; the merge context already holds it, so no extra
  // read is issued for the file name.
  const matterNumberValue = resolution.context.values.get("matter.number");
  const matterLabel = matterNumberValue?.kind === "text" ? matterNumberValue.text : "";

  const initiated = await initiateUpload(
    firmDatabase,
    {
      matterId,
      folderId: (message.folderId as FolderId | null) ?? null,
      name: assembledDocumentName(templateVersion.templateName, matterLabel, outputFormat),
      declaredSize: outputBytes.byteLength,
      // Declared, never asserted: the ingest gate sniffs the bytes itself and quarantines a version
      // whose content disagrees with what was declared, which is exactly the check that catches a
      // conversion that returned something other than what it promised.
      declaredContentType: OUTPUT_FORMATS[outputFormat].contentType,
      uploadedBy: (message.requestedBy as UserId | null) ?? null,
      mode: "put",
      uploadKind: "interactive",
    },
    { clock: { now }, actorUserId: (message.requestedBy as UserId | null) ?? null },
  );
  await commitEffectBatch(firmDatabase, initiated.effect, { now });

  await bucket.put(initiated.r2Key, outputBytes as unknown as ArrayBuffer, {
    sha256: await sha256Hex(outputBytes),
    customMetadata: initiated.dimensions,
  });

  const completed = await completeUploadSession(
    firmDatabase,
    initiated.uploadSessionId as UploadSessionId,
    { clock: { now }, actorUserId: (message.requestedBy as UserId | null) ?? null },
  );
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        ...completed.effect.statements,
        completeDocumentAssemblyStatement(firmDatabase, {
          assemblyId,
          fileId: initiated.fileId,
          fileVersionId: initiated.versionId,
          outcome: needsReview ? "succeeded_with_absences" : "succeeded",
          absentFieldKeys: absences.map((absence) => absence.key),
          frozenFieldNames,
          completedAt: now(),
        }),
      ],
      outboxMessages: completed.effect.outboxMessages,
    },
    { now },
  );

  // Drive ingest: the bytes were written server-side, so the object-create event the ingest consumer
  // processes is enqueued here (magic-byte sniff, hash, scan, then commit or quarantine). Idempotent at
  // the consumer.
  await enqueueDevIngestEvent(env, bucketName, initiated.r2Key, outputBytes.byteLength);

  await coordinatorFor(env, message).markDone(initiated.fileId, initiated.versionId);

  logger.log(
    documentAssembled(
      { correlationId: message.assemblyId, now: now() },
      {
        outcome: needsReview ? "succeeded-with-absences" : "succeeded",
        reason: "",
        // Both classes of blank, counted together: a field nothing resolved and a field nothing
        // substituted are the same number to whoever reads this — how many holes the document has.
        absenceCount: absences.length + frozenFieldNames.length,
      },
    ),
  );
  logger.count(documentAssemblyJobs.metricName, { outcome: "succeeded", stage: "done" });
  return undefined;
}

export async function documentAssemblyQueue(
  batch: MessageBatch<DocumentAssemblyMessage>,
  env: Bindings,
  // The per-engine-id resolver the PDF arm converts through. Injected on the same terms the conversion
  // consumer takes it: the engine Containers cannot run under the local test pool, so a test that
  // exercises the PDF arm supplies its own port rather than the deployment's.
  resolveEngines: (env: Bindings) => EngineResolver = resolveEnginePort,
): Promise<void> {
  for (const message of batch.messages) {
    const logger = createWorkersLogger(env.TELEMETRY);
    const now = (): string => new Date().toISOString();
    try {
      const failure = await assembleOne(env, message.body, resolveEngines);
      if (failure !== undefined) {
        const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, message.body.firmId);
        await commitEffectBatch(
          firmDatabase,
          {
            statements: [
              failDocumentAssemblyStatement(
                firmDatabase,
                message.body.assemblyId as DocumentAssemblyId,
                failure.code,
                failure.keys,
                now(),
              ),
            ],
            outboxMessages: [],
          },
          { now },
        );
        await coordinatorFor(env, message.body).markFailed(failure.code);
        logger.log(
          documentAssembled(
            { correlationId: message.body.assemblyId, now: now() },
            { outcome: "failed", reason: failure.code, absenceCount: failure.keys.length },
          ),
        );
        logger.count(documentAssemblyJobs.metricName, {
          outcome: "failed",
          stage: failure.stage,
        });
      }
      // A typed failure is TERMINAL — the template is quarantined, the matter is gone, a required
      // field has no value. Retrying it would burn the message's attempts against a condition no
      // redelivery changes and dead-letter a job whose outcome is already recorded, so it is acked.
      message.ack();
    } catch (caught) {
      // Transport or unexpected failure: mark failed (the coordinator guards against clobbering a
      // done) and retry, because this class of failure a redelivery genuinely can fix. The detail
      // goes through the one standard pipeline, correlated by the assembly handle and redacted — a
      // merge value must never reach a log line even on the way out.
      await coordinatorFor(env, message.body).markFailed("assembly-error");
      logOperationFailed(logger, "documentAssembly.run", caught, message.body.assemblyId);
      logger.count(documentAssemblyJobs.metricName, { outcome: "failed", stage: "file" });
      message.retry();
    }
  }
}
