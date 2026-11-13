/*
 * The worker that changes a PDF: it takes the document's bytes and one operation, runs the firm's
 * own engine over them, and posts back the new bytes or the reason it refused.
 *
 * It is separate from the page-drawing worker ($lib/documents/pdf-render.worker.ts) on purpose. That
 * worker holds one document open to draw it and is asked for a page at a time; this one is asked
 * for a whole new document and holds nothing between asks. Keeping them apart means a long
 * redaction never stalls the pages the reader is looking at.
 *
 * A failure crosses back as the engine's own message, which never carries document content or a
 * password (the engine's error contract), so it can be shown to the reader as it stands.
 */
import {
  DecompressionBombError,
  detectDocument,
  inspectSecurity,
  readForm,
  redactDocument,
  sanitizeDocument,
  secureDocument,
  stampBates,
  watermarkDocument,
} from "@magna-carta/pdf";
import { countReadings } from "./secure.ts";
import { arrangeDocument } from "./arrange-document.ts";
import type { PdfOperationReply, PdfOperationRequest } from "./pdf-operations.ts";

const scope = self as unknown as {
  postMessage(message: PdfOperationReply, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PdfOperationRequest>) => void,
  ): void;
};

async function run(request: PdfOperationRequest): Promise<PdfOperationReply> {
  const bytes = new Uint8Array(request.bytes);
  try {
    switch (request.operation.kind) {
      case "redact": {
        const result = await redactDocument(bytes, [...request.operation.regions], {
          scrub: request.operation.removeHiddenData
            ? {}
            : {
                metadata: false,
                attachments: false,
                xfa: false,
                formFieldValues: false,
                structureTree: false,
                outlines: false,
                optionalContent: false,
              },
        });
        return {
          kind: "done",
          id: request.id,
          documents: [result.pdf],
          pagesChanged: result.pagesRedacted.length,
        };
      }
      case "arrange": {
        const documents: Uint8Array[] = [];
        for (const plan of request.operation.plans)
          documents.push(await arrangeDocument(bytes, plan));
        return {
          kind: "done",
          id: request.id,
          documents,
          pagesChanged: request.operation.plans.reduce(
            (total, plan) =>
              total + plan.runs.reduce((count, piece) => count + piece.end - piece.start + 1, 0),
            0,
          ),
        };
      }
      case "bates": {
        const result = await stampBates(bytes, { ...request.operation.options });
        return {
          kind: "done",
          id: request.id,
          documents: [result.pdf],
          pagesChanged: result.pageCount,
        };
      }
      case "watermark": {
        const options = request.operation.options;
        const result = await watermarkDocument(bytes, options);
        return {
          kind: "done",
          id: request.id,
          documents: [result.pdf],
          pagesChanged: options.pages?.length ?? 0,
        };
      }
      case "inspect": {
        const security = await inspectSecurity(bytes);
        if (security.encrypted) {
          return {
            kind: "done",
            id: request.id,
            documents: [],
            pagesChanged: 0,
            readings: countReadings(security, [], []),
          };
        }
        const [report, fields] = await Promise.all([detectDocument(bytes), readForm(bytes)]);
        return {
          kind: "done",
          id: request.id,
          documents: [],
          pagesChanged: 0,
          // Counted here, inside the worker, so the recovered text never reaches the page.
          readings: countReadings(
            security,
            report.findings,
            fields.map((field) => field.value),
          ),
        };
      }
      case "secure": {
        const scrubbed = request.operation.scrubFirst ? (await sanitizeDocument(bytes)).pdf : bytes;
        const result = await secureDocument(scrubbed, { ...request.operation.options });
        return { kind: "done", id: request.id, documents: [result.pdf], pagesChanged: 0 };
      }
      default:
        return { kind: "failed", id: request.id, reason: "unsupported", message: "" };
    }
  } catch (error) {
    if (error instanceof DecompressionBombError) {
      return { kind: "failed", id: request.id, reason: "decompression-bomb", message: "" };
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("locked with a password")) {
      return { kind: "failed", id: request.id, reason: "locked", message };
    }
    return { kind: "failed", id: request.id, reason: "refused", message };
  }
}

scope.addEventListener("message", (event) => {
  void run(event.data).then((reply) => {
    scope.postMessage(
      reply,
      reply.kind === "done" ? reply.documents.map((document) => document.buffer) : [],
    );
  });
});
