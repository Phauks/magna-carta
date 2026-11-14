// @magna-carta/signing — first-party e-signature: the PAdES platform seal and the ESIGN/UETA model.
//
// The pure-Rust pdf-core engine owns the PDF signature structure (behind the SealEngine port); this
// package owns the CMS/PKCS#7 seal (host-side WebCrypto) and the legal product layer. Subpath
// exports (./cms, ./engine, ./esign, ./seal) let consumers pull only what they need.

export { fromBase64, toArrayBuffer, toBase64 } from "./bytes.ts";
export {
  buildDetachedCms,
  verifyDetachedCms,
  type CmsHashAlgorithm,
  type DetachedCmsInput,
} from "./cms.ts";
export {
  assembleCertificateOfCompletion,
  certificateDefects,
  certificateReference,
  renderCertificateOfCompletion,
  signerDisplayName,
  type CertificateDefect,
} from "./certificate.ts";
export {
  certificateSheet,
  certificateSheetImages,
  type CertificateSheet,
  type CertificateSheetOptions,
  type CertificateSheetBlock,
} from "./certificate-sheet.ts";
export type { ByteRange, PrepareSealOptions, PreparedSeal, SealEngine } from "./engine.ts";
export {
  decodeSealRequest,
  decodeSealResponse,
  encodeSealRequest,
  encodeSealResponse,
  type SealMetadata,
  type SealPort,
  type SealRequest,
  type SignatureImage,
  type SealResponse,
} from "./port.ts";
export {
  ATTRIBUTION_ORDER,
  SIGNING_EVENT_KINDS,
  attributionMeets,
  type AttributionLevel,
  type CertificateOfCompletion,
  type ConsentRecord,
  type SignatureAdoption,
  type SignerAttribution,
  type SignerCompletion,
  type SigningContact,
  type SigningEnvelope,
  type SigningEvent,
  type SigningEventKind,
  type SigningIntent,
  type SigningParty,
} from "./esign.ts";
export {
  generatePlatformSealIdentity,
  type PlatformSealIdentity,
  type PlatformSealIdentityOptions,
} from "./platform-certificate.ts";
export {
  OFFERED_ATTRIBUTION,
  SELF_FILLING_KINDS,
  SIGNING_FIELD_KINDS,
  completionCounts,
  decline,
  draftProblems,
  fieldsInReadingOrder,
  hasExpired,
  isComplete,
  nextField,
  open,
  send,
  sign,
  signersToNotify,
  voidRequest,
  type FieldAnswers,
  type RequestSigner,
  type RequestStatus,
  type SignerStatus,
  type SigningField,
  type SigningFieldKind,
  type SigningOrder,
  type SigningRequestState,
  type Transition,
} from "./request.ts";
export {
  sealDocument,
  toPdfDate,
  type SealDocumentInput,
  type SealDocumentResult,
} from "./seal.ts";
