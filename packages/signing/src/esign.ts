// The ESIGN/UETA electronic-signature model — the legal product layer around the seal.
//
// ESIGN (federal) and UETA (e.g. Nevada, NRS Ch. 719) validate an electronic signature on four
// elements — intent, consent to transact electronically, association of the signature with the
// record, and attribution — none requiring per-signer cryptography. The platform seal makes the
// completed record tamper-evident; these types capture the recorded signing act and the
// server-observed audit that make it defensible. Persisting the audit trail and rendering the
// Certificate of Completion are the surrounding work; the model that binds them lives here.

/**
 * Attribution assurance, weakest to strongest, keyed to document risk. Internal signers are already
 * authenticated (strongest); external signers tier up from a tokenized email link. Order matters —
 * `ATTRIBUTION_ORDER` and `attributionMeets` compare against a required minimum.
 */
export type AttributionLevel =
  | "email-link" // tokenized email link — possession baseline
  | "access-code" // email/SMS one-time access code
  | "id-verified" // ID document / knowledge-based verification (high-stakes)
  | "portal-authenticated" // signed while authenticated in the client portal
  | "firm-authenticated"; // internal user authenticated to the firm

/** The assurance ladder in ascending strength. */
export const ATTRIBUTION_ORDER: readonly AttributionLevel[] = [
  "email-link",
  "access-code",
  "id-verified",
  "portal-authenticated",
  "firm-authenticated",
];

/** Whether `level` is at least as strong as `minimum` on the attribution ladder. */
export function attributionMeets(level: AttributionLevel, minimum: AttributionLevel): boolean {
  return ATTRIBUTION_ORDER.indexOf(level) >= ATTRIBUTION_ORDER.indexOf(minimum);
}

/** How the signer adopted their visible signature. */
export type SignatureAdoption = "typed" | "drawn" | "uploaded";

/** The signer's affirmative intent to sign — the ESIGN/UETA "intent" element. */
export interface SigningIntent {
  readonly signerId: string;
  readonly adoption: SignatureAdoption;
  /** When intent was affirmed, ISO 8601 (server-observed). */
  readonly affirmedAt: string;
}

/** The signer's consent to transact electronically — the ESIGN/UETA "consent" element. */
export interface ConsentRecord {
  /** The disclosure text version the signer accepted, so the exact wording is reconstructible. */
  readonly disclosureVersion: string;
  /** When consent was given, ISO 8601 (server-observed). */
  readonly consentedAt: string;
}

/** How the signature is attributed to the signer — the ESIGN/UETA "attribution" element. */
export interface SignerAttribution {
  readonly level: AttributionLevel;
  /** The IP the signing act was observed from (server-observed, never client-self-reported). */
  readonly observedIp?: string;
  /** The identity channel proof reference (portal session id, access-code delivery id, etc.). */
  readonly proofReference?: string;
}

/** A completed signer's authoritative record — one entry in the Certificate of Completion. */
export interface SignerCompletion {
  readonly intent: SigningIntent;
  readonly consent: ConsentRecord;
  readonly attribution: SignerAttribution;
}

/**
 * The Certificate of Completion — assembled from the authoritative, server-observed audit trail and
 * stored with the sealed document. The document hash binds it to the exact bytes the seal covers.
 */
export interface CertificateOfCompletion {
  /** Lowercase hex SHA-256 of the sealed byte range — the association to the record. */
  readonly documentHashSha256: string;
  /** When the seal was applied, ISO 8601. */
  readonly sealedAt: string;
  readonly signers: readonly SignerCompletion[];
}
