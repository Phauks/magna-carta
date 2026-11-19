/*
 * The reconciliation report as a PDF, composed in the export Worker every house document goes
 * through (lib/export/render-pdf.worker.ts), off the main thread, and opened in a new tab where
 * the browser's own print dialog sends it to the printer.
 */
import type { HouseDocument } from "@magna-carta/house-document";
import type { PdfComposeReply } from "$lib/export/render-pdf.ts";

export class ReportPdfError extends Error {}

export function composeReportPdf(document: HouseDocument): Promise<Blob> {
  const worker = new Worker(new URL("../../export/render-pdf.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<Blob>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<PdfComposeReply>) => {
      worker.terminate();
      if (event.data.kind === "done") {
        resolve(new Blob([event.data.pdf], { type: "application/pdf" }));
      } else {
        reject(new ReportPdfError(event.data.reason));
      }
    });
    worker.addEventListener("error", () => {
      worker.terminate();
      reject(new ReportPdfError("Couldn't make the PDF on this device. Try again."));
    });
    worker.postMessage(document);
  });
}
