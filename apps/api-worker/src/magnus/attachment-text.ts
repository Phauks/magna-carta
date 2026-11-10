import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MagnusConversationId } from "@magna-carta/identifiers/types";
import { ATTACHMENT_SOURCE_MAX_BYTES } from "@magna-carta/magnus/limits";
import { listAttachmentsWithFiles, type AttachmentWithFile } from "@magna-carta/magnus/statements";
import type { WindowAttachment } from "@magna-carta/magnus/window";
import type { TextExtractionPort } from "@magna-carta/search/extraction";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { resolveTextExtractionPort } from "../search/text-extraction.ts";

// THE TEXT OF A CONVERSATION'S ATTACHED FILES, read fresh for every question that carries them.
//
// An attachment is a REFERENCE to a matter's file. Nothing here writes a copy of the file's text
// anywhere: the bytes are read from the firm's own bucket, handed to the platform's one extraction
// port — the same composite reader the search index runs a document through, so the two never
// disagree about what a document says — and the result goes into the request and nowhere else. A
// stored extraction would be a second copy of privileged content outside the file's own erasure
// path, which is the cost this design refuses; what it pays instead is the extraction on each
// question, bounded by the attachment cap and the source-size cap.
//
// A plain-text file needs no engine and is read directly. Everything else goes through the port, and
// a file the port cannot read — encrypted, damaged, a format nothing parses, a scan with no
// recognizer bound — is reported as unreadable so the member is told the model saw nothing of it.
// Nothing here logs a file's content, its name, or an upstream body.

export interface ReadAttachment {
  readonly fileId: string;
  // What the surface names it by. Null where the file has been deleted since it was attached.
  readonly name: string | null;
  // The readable text, or null where none could be taken and the reason says why.
  readonly text: string | null;
  readonly unreadableReason: "deleted" | "no-version" | "too-large" | "no-text" | null;
}

export interface AttachmentTextReader {
  readAll(conversationId: MagnusConversationId): Promise<readonly ReadAttachment[]>;
}

const decoder = new TextDecoder();

// Whether a file's bytes are text as they stand. Decided from the sniffed type first and the name
// second, because a `.txt` that was sniffed as plain text and a `.md` nobody sniffs both read the
// same way.
function isPlainText(contentType: string | null, name: string | null): boolean {
  if (contentType !== null && contentType.split(";")[0]?.trim().startsWith("text/")) return true;
  const lower = (name ?? "").toLowerCase();
  return lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv");
}

async function readOne(
  attachment: AttachmentWithFile,
  bucket: R2Bucket,
  extraction: TextExtractionPort,
): Promise<ReadAttachment> {
  const fileId = attachment.fileId;
  if (attachment.fileName === null) {
    return { fileId, name: null, text: null, unreadableReason: "deleted" };
  }
  const name = attachment.fileName;
  if (attachment.objectKey === null) {
    return { fileId, name, text: null, unreadableReason: "no-version" };
  }
  if (attachment.sizeBytes !== null && attachment.sizeBytes > ATTACHMENT_SOURCE_MAX_BYTES) {
    return { fileId, name, text: null, unreadableReason: "too-large" };
  }
  const object = await bucket.get(attachment.objectKey);
  if (object === null) return { fileId, name, text: null, unreadableReason: "no-version" };
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > ATTACHMENT_SOURCE_MAX_BYTES) {
    return { fileId, name, text: null, unreadableReason: "too-large" };
  }
  if (isPlainText(attachment.contentType, name)) {
    const text = decoder.decode(bytes);
    return text.trim() === ""
      ? { fileId, name, text: null, unreadableReason: "no-text" }
      : { fileId, name, text, unreadableReason: null };
  }
  const result = await extraction.extract({ bytes, contentType: attachment.contentType });
  if (!result.ok) return { fileId, name, text: null, unreadableReason: "no-text" };
  const text = result.passages.map((passage) => passage.text).join("\n");
  return text.trim() === ""
    ? { fileId, name, text: null, unreadableReason: "no-text" }
    : { fileId, name, text, unreadableReason: null };
}

// The production reader: the firm's bucket by its firm id (a queue job carries no bucket name) and
// the platform's extraction port from the environment. Both are resolved lazily, on the first
// conversation that actually has attachments, so a question with none costs no control-plane read.
export function resolveAttachmentTextReader(
  env: Bindings,
  firmId: string,
  firmDatabase: SqlDatabase,
): AttachmentTextReader {
  let bucket: Promise<R2Bucket> | null = null;
  let extraction: TextExtractionPort | null = null;
  return {
    async readAll(conversationId) {
      const attachments = await listAttachmentsWithFiles(firmDatabase, conversationId);
      if (attachments.length === 0) return [];
      bucket ??= resolveFirmBucketForFirmId(env, firmId).then((resolved) => resolved.bucket);
      extraction ??= resolveTextExtractionPort(env);
      const resolvedBucket = await bucket;
      const port = extraction;
      // Sequential on purpose: each read may run an extraction, and a conversation's attachments
      // are few by the cap. Running ten extractions at once against a shared container buys nothing
      // and costs the neighbours.
      const read: ReadAttachment[] = [];
      for (const attachment of attachments) {
        read.push(await readOne(attachment, resolvedBucket, port));
      }
      return read;
    },
  };
}

// What the window builder is handed: only the attachments that yielded text, named as the member
// knows them. The rest are reported by the caller from the read outcomes.
export function windowAttachmentsFrom(read: readonly ReadAttachment[]): WindowAttachment[] {
  return read.flatMap((attachment) =>
    attachment.text === null || attachment.name === null
      ? []
      : [{ fileId: attachment.fileId, name: attachment.name, text: attachment.text }],
  );
}
