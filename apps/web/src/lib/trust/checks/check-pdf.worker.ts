/*
 * The worker that composes a batch of checks or a test page into a PDF. One document per worker;
 * the caller terminates it on the answer. Checks print in Liberation Sans: a payee in any script
 * the firm writes is drawn, and its figures are the plain shapes a bank's reader expects.
 */
import { composeDocument, type ComposeDocument } from "@magna-carta/pdf-compose";
import type { CheckPdfReply } from "./check-pdf.ts";

const scope = self as unknown as {
  postMessage(message: CheckPdfReply, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ComposeDocument>) => void): void;
};

scope.addEventListener("message", (event) => {
  void (async () => {
    try {
      const composed = await composeDocument(event.data, []);
      const pdf = composed.pdf.slice().buffer;
      scope.postMessage({ kind: "done", pdf }, [pdf]);
    } catch (error) {
      scope.postMessage({
        kind: "failed",
        reason:
          error instanceof Error ? `Couldn't make the PDF: ${error.message}` : "Couldn't make the PDF.",
      });
    }
  })();
});
