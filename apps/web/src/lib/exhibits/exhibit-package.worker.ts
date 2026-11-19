/*
 * The worker that makes an exhibit list and an exhibit package: it composes the list and the cover
 * sheets with the platform's PDF composer, counts and joins the exhibits' pages, and stamps the
 * Bates numbers, all off the main thread. One package per worker; the caller terminates it.
 *
 * It is asked twice for a package. First to measure: how many pages the list takes and how many
 * each exhibit has, which is what the Bates range is sized from. Then to build, with the range the
 * matter's register handed out. A failure crosses back as the engine's own message, which never
 * quotes a document's content.
 */
import { composeReadable, housePictures, type HouseDocument } from "@magna-carta/house-document";
import { loadDocument, mergeDocuments, stampBates } from "@magna-carta/pdf";
import { composeDocument } from "@magna-carta/pdf-compose";
import type { PackageWorkerReply, PackageWorkerRequest } from "./exhibit-package.ts";

const scope = self as unknown as {
  postMessage(message: PackageWorkerReply, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PackageWorkerRequest>) => void,
  ): void;
};

async function compose(document: HouseDocument): Promise<{ pdf: Uint8Array; pageCount: number }> {
  const pictures = housePictures();
  const composed = await composeReadable((typeface) =>
    composeDocument({ ...document, ...(typeface ? { typeface } : {}) }, pictures),
  );
  return { pdf: composed.pdf, pageCount: composed.pageCount };
}

/** The page count of a PDF the engine can open, or null for one it cannot (locked, not a PDF). */
async function pagesOf(bytes: ArrayBuffer): Promise<number | null> {
  try {
    const document = await loadDocument(new Uint8Array(bytes));
    try {
      return document.pageCount;
    } finally {
      document.free();
    }
  } catch {
    return null;
  }
}

async function run(request: PackageWorkerRequest): Promise<PackageWorkerReply> {
  if (request.kind === "measure") {
    const list = await compose(request.list);
    const pageCounts: (number | null)[] = [];
    for (const bytes of request.documents) pageCounts.push(await pagesOf(bytes));
    return { kind: "measured", listPages: list.pageCount, pageCounts };
  }
  const list = await compose(request.list);
  const parts: Uint8Array[] = [list.pdf];
  if (request.covers.length > 0) {
    for (const [index, cover] of request.covers.entries()) {
      parts.push((await compose(cover)).pdf);
      const exhibit = request.documents[index];
      if (exhibit !== undefined) parts.push(new Uint8Array(exhibit));
    }
  }
  const joined = parts.length === 1 ? list.pdf : (await mergeDocuments(parts)).pdf;
  const finished = request.bates === null ? joined : (await stampBates(joined, request.bates)).pdf;
  const pdf = finished.slice().buffer;
  return { kind: "built", pdf, listPages: list.pageCount };
}

scope.addEventListener("message", (event) => {
  void (async () => {
    try {
      const reply = await run(event.data);
      scope.postMessage(reply, reply.kind === "built" ? [reply.pdf] : []);
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
