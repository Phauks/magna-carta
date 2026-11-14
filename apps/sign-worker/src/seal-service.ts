import { createSealEngine, loadDocument } from "@magna-carta/pdf";
import { composeDocument, ensureReady as ensureComposerReady } from "@magna-carta/pdf-compose";
import {
  assembleCertificateOfCompletion,
  certificateSheet,
  certificateSheetImages,
  type CertificateSheetOptions,
  renderCertificateOfCompletion,
  sealDocument,
  type SealRequest,
  type SealResponse,
  type SigningEnvelope,
} from "@magna-carta/signing";

import type { PlatformIdentity } from "./platform-identity.ts";

/** The compiled engines the seal needs: the PDF engine and the PDF composer. */
export interface SealEngines {
  readonly pdf: WebAssembly.Module;
  readonly compose: WebAssembly.Module;
}

/**
 * The envelope as the certificate prints it. The page count is read from the document itself when
 * the caller did not send one, so the certificate states what was sealed and not what was claimed.
 */
async function describedEnvelope(
  request: SealRequest,
  pdfWasm: WebAssembly.Module,
): Promise<SigningEnvelope | undefined> {
  if (request.envelope === undefined || request.envelope.pageCount !== undefined) {
    return request.envelope;
  }
  const document = await loadDocument(request.document, pdfWasm);
  try {
    return { ...request.envelope, pageCount: document.pageCount };
  } finally {
    document.free();
  }
}

/**
 * Apply the platform seal to one document and issue its Certificate of Completion: the record, its
 * plain text, and the PDF sheet with the audit log, which is sealed in turn so the certificate is as
 * tamper-evident as the document it describes. The WASM engines and the CMS (pkijs) run here; the
 * private key only signs. Injecting the engines keeps this function testable with modules from
 * either the bundler (workerd) or a file (node).
 *
 * Throws if the request cannot form a sound seal (an unparseable PDF, a CMS larger than the reserved
 * `/Contents`, or no signers for the Certificate of Completion) — the caller maps that to a 422.
 */
export async function performSeal(
  request: SealRequest,
  identity: PlatformIdentity,
  engines: SealEngines,
  certificateSupportEmail?: string,
): Promise<SealResponse> {
  const engine = createSealEngine(engines.pdf);
  const signingTime = new Date(request.signingTime);
  const result = await sealDocument({
    pdf: request.document,
    engine,
    signingKey: identity.signingKey,
    certificate: identity.certificate,
    signingTime,
    seal: request.seal,
  });

  const envelope = await describedEnvelope(request, engines.pdf);
  const certificate = assembleCertificateOfCompletion({
    documentHashSha256: result.documentHashSha256,
    sealedAt: request.signingTime,
    signers: request.signers,
    ...(envelope !== undefined ? { envelope } : {}),
    ...(request.events !== undefined ? { events: request.events } : {}),
  });

  await ensureComposerReady(engines.compose);
  const issuer =
    certificateSupportEmail === undefined
      ? {}
      : { issuerContact: { name: "Magna Carta", email: certificateSupportEmail } };
  // The sheet is composed with the signers' signatures where it can be. A signature that is not
  // a readable picture is left off (the record of how it was adopted stays), and a name in a
  // script the certificate's own typeface cannot draw sets the sheet in Liberation Sans, which
  // draws Greek and Cyrillic as well.
  const composeSheet = async (options: CertificateSheetOptions) =>
    composeDocument(
      certificateSheet(certificate, options),
      certificateSheetImages(options.signatureImages, options.initialsImages),
    );
  const composeReadable = async (options: CertificateSheetOptions) => {
    const first = await composeSheet(options);
    return first.missingCharacters.length > 0
      ? composeSheet({ ...options, typeface: "liberationSans" })
      : first;
  };
  let sheet: Awaited<ReturnType<typeof composeSheet>>;
  const signatureImages = request.signatureImages ?? [];
  const initialsImages = request.initialsImages ?? [];
  try {
    sheet = await composeReadable({ ...issuer, signatureImages, initialsImages });
  } catch (error) {
    if (signatureImages.length + initialsImages.length === 0) throw error;
    sheet = await composeReadable(issuer);
  }
  const sealedSheet = await sealDocument({
    pdf: sheet.pdf,
    engine,
    signingKey: identity.signingKey,
    certificate: identity.certificate,
    signingTime,
    seal: { reason: "Certificate of Completion" },
  });

  return {
    sealedPdf: result.sealedPdf,
    documentHashSha256: result.documentHashSha256,
    certificate,
    certificateText: renderCertificateOfCompletion(certificate),
    certificatePdf: sealedSheet.sealedPdf,
  };
}
