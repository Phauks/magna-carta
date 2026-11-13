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
  /** The signer's name as it was entered on the request, shown on the certificate. */
  readonly name?: string;
  /** The address the request was sent to. */
  readonly email?: string;
  readonly adoption: SignatureAdoption;
  /**
   * How many signature blocks this signer completed in the document. Absent, the certificate
   * counts one: the signing act this record is.
   */
  readonly signatureCount?: number;
  /** How many initial blocks this signer completed. Absent, the certificate counts none. */
  readonly initialCount?: number;
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
  /** The browser or device the signing act was observed from (the request's own header). */
  readonly userAgent?: string;
  /** The identity channel proof reference (portal session id, access-code delivery id, etc.). */
  readonly proofReference?: string;
}

/** A completed signer's authoritative record — one entry in the Certificate of Completion. */
export interface SignerCompletion {
  readonly intent: SigningIntent;
  readonly consent: ConsentRecord;
  readonly attribution: SignerAttribution;
}

/** A person named on the certificate who is not a signer: the member who sent the request. */
export interface SigningParty {
  readonly name: string;
  readonly email?: string;
}

/** Who a reader of the certificate asks about it: the firm, or the person who sent the request. */
export interface SigningContact {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
}

/**
 * What was sent for signature: the identifying facts printed at the top of the certificate, the way
 * a signing platform prints its envelope summary.
 */
export interface SigningEnvelope {
  /** The request's own identifier, which the signed document and the audit trail also carry. */
  readonly id: string;
  /** The document's title or file name. */
  readonly title?: string;
  /** The page count of the document that was signed. */
  readonly pageCount?: number;
  readonly sender?: SigningParty;
  /** Printed as the contact for questions. Without one, the sender is the contact. */
  readonly contact?: SigningContact;
  /** When the request was created, ISO 8601 (server-observed). */
  readonly createdAt?: string;
}

/** A step in the life of a signing request. */
export type SigningEventKind =
  | "created"
  | "sent"
  | "delivered"
  | "viewed"
  | "identity-verified"
  | "consented"
  | "signed"
  | "declined"
  | "reassigned"
  | "reminded"
  | "voided"
  | "completed"
  | "sealed";

/** Every step a certificate can list, in the order they are told apart when two share an instant. */
export const SIGNING_EVENT_KINDS: readonly SigningEventKind[] = [
  "created",
  "sent",
  "delivered",
  "reminded",
  "viewed",
  "identity-verified",
  "consented",
  "signed",
  "declined",
  "reassigned",
  "voided",
  "completed",
  "sealed",
];

/** One line of the audit log: what happened, when, and what the server saw of who did it. */
export interface SigningEvent {
  readonly kind: SigningEventKind;
  /** When it happened, ISO 8601 (server-observed). */
  readonly at: string;
  /** Who did it, as a name or an address. Absent for a step the system took itself. */
  readonly actor?: string;
  readonly observedIp?: string;
  readonly userAgent?: string;
  /** A short qualifier, such as the address a request was sent to. Never document content. */
  readonly detail?: string;
}

/**
 * The Certificate of Completion — assembled from the authoritative, server-observed audit trail and
 * stored with the sealed document. The document hash binds it to the exact bytes the seal covers.
 */
export interface CertificateOfCompletion {
  /** Lowercase hex SHA-256 of the sealed byte range — the association to the record. */
  readonly documentHashSha256: string;
  /**
   * The certificate's number as a person reads and quotes it, such as `MC-B996-78C5-5ADD`: the
   * first twelve characters of the document hash, so it can be checked against the hash and found
   * again from it.
   */
  readonly reference: string;
  /** When the seal was applied, ISO 8601. */
  readonly sealedAt: string;
  readonly signers: readonly SignerCompletion[];
  /** What was sent for signature. Absent for a document sealed outside a signing request. */
  readonly envelope?: SigningEnvelope;
  /**
   * The audit log, oldest first. It always holds each signer's consent and signature and the seal;
   * a signing request adds the steps only it observes (sent, viewed, declined, and so on).
   */
  readonly events?: readonly SigningEvent[];
}
