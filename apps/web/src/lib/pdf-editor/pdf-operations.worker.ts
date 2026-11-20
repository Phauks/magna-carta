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
  extractPdfText,
  loadDocument,
  fillForm,
  flattenForm,
  inspectSecurity,
  readForm,
  redactDocument,
  sanitizeDocument,
  secureDocument,
  stampBates,
  watermarkDocument,
} from "@magna-carta/pdf";
import { countReadings } from "./secure.ts";
import { findBatesLabels, summarizeForm, withheldPermissions } from "./pdf-summary.ts";
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
        const additions = (request.operation.additions ?? []).map(
          (addition) => new Uint8Array(addition),
        );
        for (const plan of request.operation.plans)
          documents.push(await arrangeDocument(bytes, plan, additions));
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
      case "summarize": {
        const security = await inspectSecurity(bytes);
        const limits = withheldPermissions(security);
        if (security.hasUserPassword) {
          return {
            kind: "done",
            id: request.id,
            documents: [],
            pagesChanged: 0,
            summary: {
              needsPassword: true,
              encrypted: true,
              limits,
              pages: [],
              form: null,
              bates: null,
            },
          };
        }
        const document = await loadDocument(bytes);
        const pages = Array.from({ length: document.pageCount }, (_, index) =>
          document.pageSize(index),
        );
        document.free();
        // Each of these is a reading on its own: a form the engine cannot read, or a text layer it
        // cannot walk, leaves that one row unknown rather than the whole summary.
        const [fields, text] = await Promise.all([
          readForm(bytes).catch(() => []),
          extractPdfText(bytes).catch(() => null),
        ]);
        const bates =
          text === null
            ? null
            : findBatesLabels(text.pages.map((page) => page.lines.map((line) => line.text)));
        return {
          kind: "done",
          id: request.id,
          documents: [],
          pagesChanged: 0,
          summary: {
            needsPassword: false,
            encrypted: security.encrypted,
            limits,
            pages,
            form: summarizeForm(fields),
            bates,
          },
        };
      }
      case "readForm": {
        const fields = await readForm(bytes);
        return { kind: "done", id: request.id, documents: [], pagesChanged: 0, fields };
      }
      case "fillForm": {
        const { values, flatten } = request.operation;
        // With nothing to write, flattening alone still has to run, so the copy is fixed as it stands.
        const result =
          Object.keys(values).length === 0 && flatten
            ? await flattenForm(bytes)
            : await fillForm(bytes, { ...values }, { flatten });
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
