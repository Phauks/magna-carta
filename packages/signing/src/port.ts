// The SealPort — the typed contract for the platform sealing service.
//
// Sealing runs in a dedicated worker that holds the platform signing key; every other worker (the
// app worker for matter documents, and later the client portal, document automation, discovery
// production) reaches it through this one port, so the key lives in exactly one place and there is a
// single authoritative signing service. This module is the contract plus the shared wire codec, so
// both sides of the service binding serialize identically and never drift.

import { fromBase64, toBase64 } from "./bytes.ts";
import type {
  CertificateOfCompletion,
  SignerCompletion,
  SigningEnvelope,
  SigningEvent,
} from "./esign.ts";

/** Signature-dictionary fields the caller may set (the engine adds the signing time itself). */
export interface SealMetadata {
  readonly name?: string;
  readonly reason?: string;
  readonly location?: string;
  readonly contactInfo?: string;
  /** Bytes reserved for the CMS; defaults to the engine's own reservation. */
  readonly contentsCapacity?: number;
}

/** A request to seal one document. */
export interface SealRequest {
  /** The PDF to seal. */
  readonly document: Uint8Array;
  /** The server-observed signer records that populate the Certificate of Completion. */
  readonly signers: readonly SignerCompletion[];
  /** The signing time, ISO 8601 — the caller supplies it (server clock), keeping the port clock-free. */
  readonly signingTime: string;
  /** Optional signature-dictionary fields. */
  readonly seal?: SealMetadata;
  /** What was sent for signature, printed at the top of the certificate. */
  readonly envelope?: SigningEnvelope;
  /**
   * The steps the signing request observed and stored (sent, viewed, declined and so on), for the
   * certificate's audit log. Each signer's consent and signature and the seal need not be repeated.
   */
  readonly events?: readonly SigningEvent[];
}

/** The sealed result. */
export interface SealResponse {
  /** The sealed PDF: the input preserved as its prefix, with the CMS embedded in `/Contents`. */
  readonly sealedPdf: Uint8Array;
  /** Lowercase hex SHA-256 of the signed byte range. */
  readonly documentHashSha256: string;
  /** The assembled Certificate of Completion. */
  readonly certificate: CertificateOfCompletion;
  /** The rendered plain-text Certificate of Completion (the artifact stored with the seal). */
  readonly certificateText: string;
  /**
   * The Certificate of Completion as a PDF: the confirmation sheet and audit log, itself sealed with
   * the platform certificate. Filed beside the signed document.
   */
  readonly certificatePdf: Uint8Array;
}

/** The platform sealing service. One implementation runs in the sign-worker; the app worker holds
 *  an adapter that forwards over the service binding. */
export interface SealPort {
  seal(request: SealRequest): Promise<SealResponse>;
}

// ── Wire codec ──────────────────────────────────────────────────────────────
// The binary fields cross the service binding base64-encoded inside a JSON envelope. Shared here so
// the sign-worker and the app-worker adapter encode/decode with one implementation.

interface WireSealRequest {
  document: string;
  signers: readonly SignerCompletion[];
  signingTime: string;
  seal?: SealMetadata;
  envelope?: SigningEnvelope;
  events?: readonly SigningEvent[];
}

interface WireSealResponse {
  sealedPdf: string;
  documentHashSha256: string;
  certificate: CertificateOfCompletion;
  certificateText: string;
  certificatePdf: string;
}

export function encodeSealRequest(request: SealRequest): string {
  const wire: WireSealRequest = {
    document: toBase64(request.document),
    signers: request.signers,
    signingTime: request.signingTime,
    seal: request.seal,
    envelope: request.envelope,
    events: request.events,
  };
  return JSON.stringify(wire);
}

export function decodeSealRequest(json: string): SealRequest {
  const wire = JSON.parse(json) as WireSealRequest;
  return {
    document: fromBase64(wire.document),
    signers: wire.signers,
    signingTime: wire.signingTime,
    seal: wire.seal,
    ...(wire.envelope !== undefined ? { envelope: wire.envelope } : {}),
    ...(wire.events !== undefined ? { events: wire.events } : {}),
  };
}

export function encodeSealResponse(response: SealResponse): string {
  const wire: WireSealResponse = {
    sealedPdf: toBase64(response.sealedPdf),
    documentHashSha256: response.documentHashSha256,
    certificate: response.certificate,
    certificateText: response.certificateText,
    certificatePdf: toBase64(response.certificatePdf),
  };
  return JSON.stringify(wire);
}

export function decodeSealResponse(json: string): SealResponse {
  const wire = JSON.parse(json) as WireSealResponse;
  return {
    sealedPdf: fromBase64(wire.sealedPdf),
    documentHashSha256: wire.documentHashSha256,
    certificate: wire.certificate,
    certificateText: wire.certificateText,
    certificatePdf: fromBase64(wire.certificatePdf),
  };
}
