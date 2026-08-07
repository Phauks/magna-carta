import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
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
import { readTemplateVersionForAssembly } from "@magna-carta/document-assembly/template-statements";
import type { FieldManifest } from "@magna-carta/document-assembly/types";
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
import type { Bindings } from "../app.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";
import { loadEffectivePermissions } from "../session-context.ts";
import type { DocumentAssemblyMessage } from "./assembly-types.ts";

// The assembly consumer: read the template version's bytes, resolve the merge context through the
// firm-scoped data-access layer, assemble, and file the output.
//
// THE OUTPUT ENTERS THE NORMAL FILE PIPELINE, SCAN INCLUDED. The tempting shortcut is to commit a
// server-generated version directly as `clean`, since we produced the bytes. It is refused: the moment
// there are two ways for a version to reach `clean`, the invariant that every file_version read filters
// on status stops being enforceable by construction, and the second path is the one that will be wrong.
// initiateUpload / completeUploadSession plus the ingest event is the one entrance, the same one the
// email-filing attachment path uses.
//
// The stage names are the telemetry dimension for where a job ends, so they are a closed set here.
type AssemblyStage = "load-template" | "read-bytes" | "resolve" | "merge" | "file" | "done";

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
      blocks: [],
      computedFields: [],
    };
  }
}

// The produced document's name: the template's name plus the matter's number, so a member looking at a
// matter's file list can tell two assemblies of the same template on different matters apart. Path
// separators and control characters are stripped — a template name is firm-authored text and the file
// name it becomes has to be a name, not a path.
export function assembledDocumentName(templateName: string, matterLabel: string): string {
  const clean = (value: string): string =>
    // eslint-disable-next-line no-control-regex -- the C0 range is exactly what has to go from a name
    value
      .replace(/[ -/\\:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const base = [clean(templateName), clean(matterLabel)].filter((part) => part !== "").join(" - ");
  return `${base === "" ? "Assembled document" : base}.docx`;
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
    { statements: [markAssemblyRunningStatement(firmDatabase, assemblyId)], outboxMessages: [] },
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

  const resolution = await resolveMergeContext(firmDatabase, {
    matterId,
    manifest,
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

  const merged = assemble(templateBytes, resolution.context, { dictionary });
  // How each expression site came out, counted whichever way the assembly went. No expression text, no
  // merge-field key, and no value is ever a dimension.
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
              : merged.reason === "expression-refused" || merged.reason === "expression-unresolved"
                ? "assembly-expression-refused"
                : "template-unreadable",
      stage: "merge",
      keys: merged.keys,
    };
  }

  for (const absence of merged.absences) {
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
  // sort on the freshly-mapped copy (nothing else holds it), matching the worker's TS lib target.
  const frozenFieldNames = manifest.unconvertedMergeFields.map((field) => field.fieldName).sort();
  for (const field of manifest.unconvertedMergeFields) {
    logger.count(documentAssemblyFrozenField.metricName, { form: field.form });
  }
  const needsReview = merged.absences.length > 0 || frozenFieldNames.length > 0;

  // The matter number labels the produced document; the merge context already holds it, so no extra
  // read is issued for the file name.
  const matterNumberValue = resolution.context.values.get("matter.number");
  const matterLabel = matterNumberValue?.kind === "text" ? matterNumberValue.text : "";

  const initiated = await initiateUpload(
    firmDatabase,
    {
      matterId,
      folderId: (message.folderId as FolderId | null) ?? null,
      name: assembledDocumentName(templateVersion.templateName, matterLabel),
      declaredSize: merged.bytes.byteLength,
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      uploadedBy: (message.requestedBy as UserId | null) ?? null,
      mode: "put",
      uploadKind: "interactive",
    },
    { clock: { now }, actorUserId: (message.requestedBy as UserId | null) ?? null },
  );
  await commitEffectBatch(firmDatabase, initiated.effect, { now });

  await bucket.put(initiated.r2Key, merged.bytes as unknown as ArrayBuffer, {
    sha256: await sha256Hex(merged.bytes),
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
          absentFieldKeys: merged.absences.map((absence) => absence.key),
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
  await enqueueDevIngestEvent(env, bucketName, initiated.r2Key, merged.bytes.byteLength);

  await coordinatorFor(env, message).markDone(initiated.fileId, initiated.versionId);

  logger.log(
    documentAssembled(
      { correlationId: message.assemblyId, now: now() },
      {
        outcome: needsReview ? "succeeded-with-absences" : "succeeded",
        reason: "",
        // Both classes of blank, counted together: a field nothing resolved and a field nothing
        // substituted are the same number to whoever reads this — how many holes the document has.
        absenceCount: merged.absences.length + frozenFieldNames.length,
      },
    ),
  );
  logger.count(documentAssemblyJobs.metricName, { outcome: "succeeded", stage: "done" });
  return undefined;
}

export async function documentAssemblyQueue(
  batch: MessageBatch<DocumentAssemblyMessage>,
  env: Bindings,
): Promise<void> {
  for (const message of batch.messages) {
    const logger = createWorkersLogger(env.TELEMETRY);
    const now = (): string => new Date().toISOString();
    try {
      const failure = await assembleOne(env, message.body);
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
