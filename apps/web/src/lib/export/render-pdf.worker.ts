/*
 * The worker that composes a tabular export into a PDF: it takes the composer's document, runs the
 * platform's PDF composer over it, and posts back the file or the reason it could not. One document
 * per worker; the caller terminates it on the answer.
 *
 * A failure crosses back as the engine's own message, which never quotes the document's content (the
 * composer's error contract), so it can be shown to the reader as it stands.
 */
import { composeReadable, housePictures, type HouseDocument } from "@magna-carta/house-document";
import { composeDocument } from "@magna-carta/pdf-compose";
import type { PdfComposeReply } from "./render-pdf.ts";

const scope = self as unknown as {
  postMessage(message: PdfComposeReply, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<HouseDocument>) => void): void;
};

scope.addEventListener("message", (event) => {
  void (async () => {
    try {
      // Set again in Liberation Sans when a name is in a script the house typeface cannot draw.
      const pictures = housePictures();
      const composed = await composeReadable((typeface) =>
        composeDocument({ ...event.data, ...(typeface ? { typeface } : {}) }, pictures),
      );
      const pdf = composed.pdf.slice().buffer;
      scope.postMessage({ kind: "done", pdf }, [pdf]);
    } catch (error) {
      scope.postMessage({
        kind: "failed",
        reason:
          error instanceof Error
            ? `Couldn't make the PDF: ${error.message}`
            : "Couldn't make the PDF.",
      });
    }
  })();
});
