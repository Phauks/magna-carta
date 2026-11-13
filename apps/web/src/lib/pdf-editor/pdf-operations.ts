/*
 * Running an operation that changes a PDF, off the main thread.
 *
 * The contract between the editor and `pdf-operations.worker.ts`, and the client the editor calls.
 * The engine and its several megabytes load inside the worker only, and only once the reader asks
 * for a change, so opening the editor costs nothing more than opening the reader does.
 */
import type {
  BatesStampOptions,
  FormField,
  FormFillValues,
  SecureOptions,
  WatermarkOptions,
} from "@magna-carta/pdf";
import type { ArrangementPlan } from "./page-arrangement.ts";
import type { DocumentReadings } from "./secure.ts";

/** One operation the worker can run. Each later tool adds its own variant here. */
export type PdfOperation =
  | {
      readonly kind: "redact";
      readonly regions: readonly {
        page: number;
        rect: { x0: number; y0: number; x1: number; y1: number };
        reason: string;
      }[];
      /** Also remove metadata, attachments, form values, bookmarks and layers. */
      readonly removeHiddenData: boolean;
    }
  | {
      /** Make one new document per plan, each from the original's pages (`page-arrangement.ts`). */
      readonly kind: "arrange";
      readonly plans: readonly ArrangementPlan[];
    }
  | {
      /** Stamp a Bates label on every page (`bates.ts`). */
      readonly kind: "bates";
      readonly options: BatesStampOptions;
    }
  | {
      /** Draw a text or image watermark on the pages (`watermark.ts`). */
      readonly kind: "watermark";
      readonly options: WatermarkOptions;
    }
  | {
      /** Count what the file carries, for the Secure tab. Makes no document. */
      readonly kind: "inspect";
    }
  | {
      /** Optionally scrub hidden data, then encrypt with a password and permissions (`secure.ts`). */
      readonly kind: "secure";
      readonly options: SecureOptions;
      readonly scrubFirst: boolean;
    }
  | {
      /** Read the form's fields and their current values (`forms.ts`). Makes no document. */
      readonly kind: "readForm";
    }
  | {
      /** Write the reader's answers into the form, and optionally flatten it. */
      readonly kind: "fillForm";
      readonly values: FormFillValues;
      readonly flatten: boolean;
    };

export interface PdfOperationRequest {
  readonly id: number;
  readonly bytes: ArrayBuffer;
  readonly operation: PdfOperation;
}

/** Why the engine did not hand a document back. */
export type PdfOperationFailure =
  /** The engine refused the input as a decompression bomb. */
  | "decompression-bomb"
  /** The document needs its password removed first. */
  | "locked"
  /** The engine refused the operation; its message says why, and carries no content. */
  | "refused"
  /** The worker died or never answered. */
  | "crashed"
  /** The worker does not know this operation. A build mismatch, never a reader's mistake. */
  | "unsupported";

export type PdfOperationReply =
  | {
      readonly kind: "done";
      readonly id: number;
      /** The new documents: one for a redaction, one per plan for an arrangement. */
      readonly documents: readonly Uint8Array[];
      /** How many pages the operation touched, for the result line. */
      readonly pagesChanged: number;
      /** What the file carries, counted. Present for an inspection only. */
      readonly readings?: DocumentReadings;
      /** The form's fields. Present for a form reading only. */
      readonly fields?: readonly FormField[];
    }
  | {
      readonly kind: "failed";
      readonly id: number;
      readonly reason: PdfOperationFailure;
      readonly message: string;
    };

/** What a failure says to the reader. */
export function describeOperationFailure(reason: PdfOperationFailure, message: string): string {
  switch (reason) {
    case "decompression-bomb":
      return "The document expands far past what a page is expected to hold, so the engine stopped rather than changing it.";
    case "locked":
      return "The document is locked with a password. Unlock it in the File Workbench first, then try again.";
    case "refused":
      return message === ""
        ? "The engine could not produce a safe copy of this document."
        : `The engine could not produce a safe copy: ${message}.`;
    case "crashed":
      return "The background worker stopped before it finished. Nothing was saved.";
    case "unsupported":
      return "This operation is not available in this version of the app. Reload the page.";
    default:
      return "The document could not be changed.";
  }
}

/**
 * Run one operation on a copy of the document. The bytes are TRANSFERRED to the worker, so the
 * caller hands over a buffer it no longer needs (a `slice` of the one it keeps). A fresh worker per
 * run, ended afterwards: an operation is rare, and an engine instance left holding a large document
 * between runs is memory the reader's pages could use.
 */
export function runPdfOperation(
  bytes: ArrayBuffer,
  operation: PdfOperation,
): Promise<PdfOperationReply> {
  const worker = new Worker(new URL("./pdf-operations.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<PdfOperationReply>((resolve) => {
    worker.addEventListener("message", (event: MessageEvent<PdfOperationReply>) => {
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener("error", () => {
      worker.terminate();
      resolve({ kind: "failed", id: 1, reason: "crashed", message: "" });
    });
    const request: PdfOperationRequest = { id: 1, bytes, operation };
    worker.postMessage(request, [bytes]);
  });
}
