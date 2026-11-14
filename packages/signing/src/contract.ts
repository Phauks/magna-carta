import { z } from "zod";

import {
  ATTRIBUTION_ORDER,
  SIGNING_EVENT_KINDS,
  type AttributionLevel as AttributionLevelName,
  type SigningEventKind,
} from "./esign.ts";

// What the seal route accepts and returns, as plain zod. The response is named with zod's own
// metadata (`.meta({ id })`), which the contract emitter reads as the component's name, so the route
// module in apps/api-worker declares its route over these without restating a field. The rule is in
// docs/conventions/api.md (_Where a contract shape lives_).

const ATTRIBUTION_LEVELS = ATTRIBUTION_ORDER as readonly [
  AttributionLevelName,
  ...AttributionLevelName[],
];
const EVENT_KINDS = SIGNING_EVENT_KINDS as readonly [SigningEventKind, ...SigningEventKind[]];

// The signer completion record as a request schema, over the same ladder, adoption set and event
// kinds ./esign.ts declares.
const AttributionLevel = z.enum(ATTRIBUTION_LEVELS);

// One picture of a signature or of initials: a PNG or JPEG of about 256 KiB at most, and the
// pages of the document it was placed on, counted from 1, where the signing flow knows them.
const SignaturePicture = z.object({
  imageBase64: z.string().min(1).max(350_000),
  pages: z.array(z.number().int().min(1).max(50_000)).max(200).optional(),
});

const SignerCompletionInput = z.object({
  intent: z.object({
    signerId: z.string().min(1),
    // Printed on the certificate. Without them the signer is named by the identifier alone.
    name: z.string().min(1).max(200).optional(),
    email: z.email().max(320).optional(),
    // The signature and initial blocks this signer completed, counted on the certificate.
    signatureCount: z.number().int().min(1).max(10_000).optional(),
    initialCount: z.number().int().min(0).max(10_000).optional(),
    adoption: z.enum(["typed", "drawn", "uploaded"]),
    affirmedAt: z.string().min(1),
  }),
  consent: z.object({
    disclosureVersion: z.string().min(1),
    consentedAt: z.string().min(1),
  }),
  attribution: z.object({
    level: AttributionLevel,
    // observedIp is server-observed, never client-self-reported (see @magna-carta/signing/esign):
    // any value the client sends is ignored and overwritten with the connecting IP in the handler.
    proofReference: z.string().optional(),
    // Where a one-time access code was sent (an email address or a telephone number). Never the
    // code itself.
    codeDestination: z.string().min(1).max(320).optional(),
  }),
  // The signer's signatures and initials as they adopted them, printed on their record in the
  // certificate. One entry for each different picture the signer used; a typed signature needs
  // none.
  signatureImages: z.array(SignaturePicture).max(8).optional(),
  initialsImages: z.array(SignaturePicture).max(8).optional(),
});

export const DocumentSealRequest = z.object({
  documentBase64: z.string().min(1),
  signers: z.array(SignerCompletionInput).min(1),
  // The document's title or file name, printed at the top of the certificate.
  documentTitle: z.string().min(1).max(255).optional(),
  // Optional signature-dictionary fields. contentsCapacity is deliberately not exposed — it is an
  // internal engine reservation detail, not a caller concern.
  seal: z
    .object({
      name: z.string().optional(),
      reason: z.string().optional(),
      location: z.string().optional(),
      contactInfo: z.string().optional(),
    })
    .optional(),
});

const SignerCompletionOutput = z.object({
  intent: z.object({
    signerId: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
    signatureCount: z.number().int().optional(),
    initialCount: z.number().int().optional(),
    adoption: z.enum(["typed", "drawn", "uploaded"]),
    affirmedAt: z.string(),
  }),
  consent: z.object({ disclosureVersion: z.string(), consentedAt: z.string() }),
  attribution: z.object({
    level: AttributionLevel,
    observedIp: z.string().optional(),
    userAgent: z.string().optional(),
    location: z.string().optional(),
    proofReference: z.string().optional(),
    codeDestination: z.string().optional(),
  }),
});

// One line of the certificate's audit log.
const SigningEventOutput = z.object({
  kind: z.enum(EVENT_KINDS),
  at: z.string(),
  actor: z.string().optional(),
  observedIp: z.string().optional(),
  userAgent: z.string().optional(),
  detail: z.string().optional(),
});

export const DocumentSealResponse = z
  .object({
    // The sealed PDF: the input preserved as its prefix, with the CMS embedded in /Contents.
    sealedPdfBase64: z.string(),
    // Lowercase hex SHA-256 of the signed byte range — the association to the record.
    documentHashSha256: z.string(),
    // The assembled Certificate of Completion (structured), plus its plain-text and PDF forms.
    certificate: z.object({
      documentHashSha256: z.string(),
      // The certificate's number as a person reads it, such as MC-B996-78C5-5ADD.
      reference: z.string(),
      sealedAt: z.string(),
      signers: z.array(SignerCompletionOutput),
      // What was sealed: the reference this seal is logged under, the title and the page count.
      envelope: z
        .object({
          id: z.string(),
          title: z.string().optional(),
          pageCount: z.number().int().optional(),
          sender: z.object({ name: z.string(), email: z.string().optional() }).optional(),
          contact: z
            .object({
              name: z.string(),
              email: z.string().optional(),
              phone: z.string().optional(),
            })
            .optional(),
          createdAt: z.string().optional(),
        })
        .optional(),
      // The audit log, oldest first.
      events: z.array(SigningEventOutput).optional(),
    }),
    certificateText: z.string(),
    // The certificate as a PDF (base64): the confirmation sheet and audit log, itself sealed with
    // the platform certificate. Filed beside the signed document.
    certificatePdfBase64: z.string(),
  })
  .meta({ id: "DocumentSealResponse" });
