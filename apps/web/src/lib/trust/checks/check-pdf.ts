/*
 * Compose a check document into a PDF in a Web Worker, off the main thread, and hand back the file.
 * The engine is about 5 MB of WebAssembly, so it loads only when a person prints.
 */
import type { ComposeDocument } from "@magna-carta/pdf-compose";

export type CheckPdfReply =
  | { readonly kind: "done"; readonly pdf: ArrayBuffer }
  | { readonly kind: "failed"; readonly reason: string };

export class CheckPdfError extends Error {}

export function composeCheckPdf(document: ComposeDocument): Promise<Blob> {
  const worker = new Worker(new URL("./check-pdf.worker.ts", import.meta.url), { type: "module" });
  return new Promise<Blob>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<CheckPdfReply>) => {
      worker.terminate();
      if (event.data.kind === "done")
        resolve(new Blob([event.data.pdf], { type: "application/pdf" }));
      else reject(new CheckPdfError(event.data.reason));
    });
    worker.addEventListener("error", () => {
      worker.terminate();
      reject(new CheckPdfError("Couldn't make the PDF on this device. Try again."));
    });
    worker.postMessage(document);
  });
}

/** Open the PDF in a new tab, where the browser's own print dialog sends it to the printer. */
export function openPdf(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
