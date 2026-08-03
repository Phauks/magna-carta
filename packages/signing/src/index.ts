// @magna-carta/signing — first-party e-signature: the PAdES platform seal and the ESIGN/UETA model.
//
// The pure-Rust pdf-core engine owns the PDF signature structure (behind the SealEngine port); this
// package owns the CMS/PKCS#7 seal (host-side WebCrypto) and the legal product layer. Subpath
// exports (./cms, ./engine, ./esign, ./seal) let consumers pull only what they need.

export {
  buildDetachedCms,
  verifyDetachedCms,
  type CmsHashAlgorithm,
  type DetachedCmsInput,
} from "./cms.ts";
export {
  assembleCertificateOfCompletion,
  certificateDefects,
  renderCertificateOfCompletion,
  type CertificateDefect,
} from "./certificate.ts";
export type { ByteRange, PrepareSealOptions, PreparedSeal, SealEngine } from "./engine.ts";
export {
  ATTRIBUTION_ORDER,
  attributionMeets,
  type AttributionLevel,
  type CertificateOfCompletion,
  type ConsentRecord,
  type SignatureAdoption,
  type SignerAttribution,
  type SignerCompletion,
  type SigningIntent,
} from "./esign.ts";
export {
  sealDocument,
  toPdfDate,
  type SealDocumentInput,
  type SealDocumentResult,
} from "./seal.ts";
