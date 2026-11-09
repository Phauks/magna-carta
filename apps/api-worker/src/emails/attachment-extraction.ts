import {
  EmailError,
  extractPart,
  type ParsedMessage,
  type PartDescriptor,
} from "@magna-carta/email";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertEmailAttachmentStatement } from "@magna-carta/data-access/email-filing-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { completeUploadSession, initiateUpload } from "@magna-carta/file-manager/file-service";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  EmailMessageId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Bindings } from "../bindings.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";

// The largest attachment part the Worker will materialize in memory to extract. Above this the part
// records an `oversize` outcome and is not extracted (the add-in path handles larger attachments). Sized
// well under the Worker's memory ceiling, leaving room for the whole message the consumer already holds.
const IN_WORKER_EXTRACT_CAP_BYTES = 25 * 1024 * 1024;

export interface AttachmentExtractionInput {
  readonly emailMessageId: EmailMessageId;
  readonly matterId: MatterId | null;
  readonly bucketName: string | null;
  readonly parsed: ParsedMessage;
  readonly rawBytes: Uint8Array;
  readonly uploadedBy: UserId | null;
  readonly correlationId: string;
  readonly logger: Logger;
}

// Extract the message's real attachments into the matter's File Manager as first-class documents,
// riding the EXISTING ingest/quarantine chokepoint (magic-byte sniff → scan → quarantine) — no scanning
// or hashing is re-implemented here. A decorative inline `cid:` image is recorded (disposition inline,
// outcome filtered_inline) but never made a document, so a later "promote to document" is a data
// change, not a re-parse. A part too large to materialize records outcome `oversize` rather than
// failing the whole message.
//
// Idempotent for the common cases: a message that already has attachment rows is skipped, so a
// redelivery or a second filer never double-files. Unrouted captures (no candidate matter) defer
// extraction until staff route them — a document must be rooted to a matter.
//
// KNOWN LIMITATION (a placed follow-up): each attachment commits independently and this all-or-nothing
// guard treats "any row exists" as done, so a crash midway through a multi-attachment message leaves the
// already-committed attachments and, on retry, skips the rest. The proper fix is a per-part ordinal on
// email_attachment plus a per-part guard (resume from the first unfiled part); it is deferred to keep
// this slice's schema minimal. Single-attachment messages (the overwhelming majority) are unaffected.
export async function extractAndFileAttachments(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  input: AttachmentExtractionInput,
): Promise<void> {
  if (input.matterId === null) return;

  const already = await firmDatabase
    .prepare("SELECT COUNT(*) AS n FROM email_attachment WHERE email_message_id = ?1")
    .bind(input.emailMessageId)
    .all<{ n: number }>();
  if ((already.results[0]?.n ?? 0) > 0) return;

  const now = (): string => new Date().toISOString();
  // extractPart materializes a part's bytes in the Worker's memory, so the extraction cap is the
  // smaller of the firm's inspectable-size cap and a Worker-safe ceiling — a part larger than the
  // Worker can hold records an `oversize` outcome rather than OOMing the consumer.
  const sizeCap = Math.min(await readInspectableSizeCap(firmDatabase), IN_WORKER_EXTRACT_CAP_BYTES);
  const metaStatements: SqlStatement[] = [];

  for (let index = 0; index < input.parsed.parts.length; index += 1) {
    const part = input.parsed.parts[index];
    if (part === undefined) continue;

    if (isDecorativeInline(part)) {
      metaStatements.push(
        insertEmailAttachmentStatement(
          firmDatabase,
          {
            id: newIdentifier("emailAttachment"),
            emailMessageId: input.emailMessageId,
            fileId: null,
            filename: part.filename,
            mediaType: part.mediaType,
            disposition: "inline",
            promotedFromInline: false,
            outcome: "filtered_inline",
          },
          now(),
        ),
      );
      continue;
    }
    if (!isRealAttachment(part)) continue;

    if (part.size > sizeCap) {
      metaStatements.push(oversizeRow(firmDatabase, input.emailMessageId, part, now()));
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await extractPart(input.rawBytes, index);
    } catch (caught) {
      if (caught instanceof EmailError && caught.code === "limitExceeded") {
        metaStatements.push(oversizeRow(firmDatabase, input.emailMessageId, part, now()));
        continue;
      }
      logOperationFailed(input.logger, "emails.attachmentExtract", caught, input.correlationId);
      throw caught;
    }

    await fileOneAttachment(env, firmDatabase, input, part, bytes, now);
  }

  if (metaStatements.length > 0) {
    await commitEffectBatch(
      firmDatabase,
      { statements: metaStatements, outboxMessages: [] },
      { now },
    );
  }
}

// Stage one attachment as a matter-rooted file/version through the File Manager, write its bytes to the
// minted R2 key, complete the session, record the email_attachment link atomically with the completion,
// then enqueue ingest so the bytes are gated/scanned exactly like an uploaded file.
async function fileOneAttachment(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  input: AttachmentExtractionInput,
  part: PartDescriptor,
  bytes: Uint8Array,
  now: () => string,
): Promise<void> {
  const initiated = await initiateUpload(
    firmDatabase,
    {
      matterId: input.matterId as MatterId,
      name: part.filename ?? "attachment",
      declaredSize: bytes.byteLength,
      declaredContentType: part.mediaType,
      uploadedBy: input.uploadedBy,
      mode: "put",
      uploadKind: "interactive",
    },
    { clock: { now }, actorUserId: input.uploadedBy },
  );
  await commitEffectBatch(firmDatabase, initiated.effect, { now });

  // The write and the event that drives ingest name one bucket, resolved once.
  const { bucket, bucketName } = resolveFirmBucket(env, input.bucketName);
  await bucket.put(initiated.r2Key, bytes, { customMetadata: initiated.dimensions });

  const completed = await completeUploadSession(
    firmDatabase,
    initiated.uploadSessionId as UploadSessionId,
    { clock: { now }, actorUserId: input.uploadedBy },
  );
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        ...completed.effect.statements,
        insertEmailAttachmentStatement(
          firmDatabase,
          {
            id: newIdentifier("emailAttachment"),
            emailMessageId: input.emailMessageId,
            fileId: initiated.fileId,
            filename: part.filename,
            mediaType: part.mediaType,
            disposition: part.disposition === "inline" ? "inline" : "attachment",
            promotedFromInline: false,
            outcome: "extracted",
          },
          now(),
        ),
      ],
      outboxMessages: completed.effect.outboxMessages,
    },
    { now },
  );

  // Drive ingest: the bytes were written server-side, so enqueue the object-create event the ingest
  // consumer processes (magic-byte sniff → scan → commit or quarantine). Idempotent at the consumer.
  await enqueueDevIngestEvent(env, bucketName, initiated.r2Key, bytes.byteLength);
}

function oversizeRow(
  firmDatabase: ProxyBatchDatabase,
  emailMessageId: EmailMessageId,
  part: PartDescriptor,
  now: string,
): SqlStatement {
  return insertEmailAttachmentStatement(
    firmDatabase,
    {
      id: newIdentifier("emailAttachment"),
      emailMessageId,
      fileId: null,
      filename: part.filename,
      mediaType: part.mediaType,
      disposition: part.disposition === "inline" ? "inline" : "attachment",
      promotedFromInline: false,
      outcome: "oversize",
    },
    now,
  );
}

// A decorative inline image: an inline part that a body references by Content-ID (a signature logo),
// never a standalone document.
function isDecorativeInline(part: PartDescriptor): boolean {
  return part.disposition === "inline" && part.contentIdentifier !== null;
}

// A real attachment: an explicit attachment part, or an inline part with no Content-ID reference
// (an inline file that no body embeds).
function isRealAttachment(part: PartDescriptor): boolean {
  return part.disposition === "attachment" || part.contentIdentifier === null;
}
