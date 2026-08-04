import { createSealEngine } from "@magna-carta/pdf";
import {
  assembleCertificateOfCompletion,
  renderCertificateOfCompletion,
  sealDocument,
  type SealRequest,
  type SealResponse,
} from "@magna-carta/signing";

import type { PlatformIdentity } from "./platform-identity.ts";

/**
 * Apply the platform seal to one document and assemble its Certificate of Completion. The WASM engine
 * (prepare/embed) and the CMS (pkijs) run here; the private key only signs. Injecting `pdfWasm` keeps
 * this function testable with a `WebAssembly.Module` from either the bundler (workerd) or a file (node).
 *
 * Throws if the request cannot form a sound seal (an unparseable PDF, a CMS larger than the reserved
 * `/Contents`, or no signers for the Certificate of Completion) — the caller maps that to a 422.
 */
export async function performSeal(
  request: SealRequest,
  identity: PlatformIdentity,
  pdfWasm: WebAssembly.Module,
): Promise<SealResponse> {
  const engine = createSealEngine(pdfWasm);
  const result = await sealDocument({
    pdf: request.document,
    engine,
    signingKey: identity.signingKey,
    certificate: identity.certificate,
    signingTime: new Date(request.signingTime),
    seal: request.seal,
  });

  const certificate = assembleCertificateOfCompletion({
    documentHashSha256: result.documentHashSha256,
    sealedAt: request.signingTime,
    signers: request.signers,
  });

  return {
    sealedPdf: result.sealedPdf,
    documentHashSha256: result.documentHashSha256,
    certificate,
    certificateText: renderCertificateOfCompletion(certificate),
  };
}
