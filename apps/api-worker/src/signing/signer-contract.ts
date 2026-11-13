import { z } from "zod";

import {
  SIGNING_FIELD_KINDS,
  fieldsInReadingOrder,
  type SigningFieldKind,
} from "@magna-carta/signing/request";
import { consentDisclosure } from "./consent-disclosure.ts";
import { needsCode, type SignerView } from "./signer-service.ts";
import { MAXIMUM_TEXT_ANSWER } from "./signer-service.ts";

// What an outside signer's page is told and sends, as plain zod named with `.meta({ id })`.
//
// THE SIGNER IS TOLD ABOUT THEIR OWN PART AND NOTHING ELSE: the firm's name, who sent it, the
// document's title and the sender's message, their own fields and where they stand. Never another
// signer's name, address or fields, never the matter, never an identifier of the firm's own records
// beyond their own fields' ids, which they send back on finishing.

const FIELD_KINDS = SIGNING_FIELD_KINDS as readonly [SigningFieldKind, ...SigningFieldKind[]];

/** The largest adopted signature or initials image accepted, in bytes before encoding. */
export const MAXIMUM_MARK_BYTES = 200_000;

export const SignerRequestView = z
  .object({
    firmName: z.string(),
    senderName: z.string(),
    title: z.string(),
    message: z.string(),
    expiresAt: z.string(),
    signerName: z.string(),
    /** Where the code is sent, partly hidden ("j***@example.com"); null when no code is needed. */
    codeSentTo: z.string().nullable(),
    needsCode: z.boolean(),
    consented: z.boolean(),
    adopted: z.boolean(),
    consent: z.object({
      version: z.string(),
      title: z.string(),
      paragraphs: z.array(z.string()),
    }),
    /** The signer's own fields, in reading order. Pages count from 1; rects are PDF points. */
    fields: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(FIELD_KINDS),
        page: z.number().int(),
        rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        required: z.boolean(),
      }),
    ),
  })
  .meta({ id: "SignerRequestView" });

export const SignerAccessCodeSent = z
  .object({ sentTo: z.string() })
  .meta({ id: "SignerAccessCodeSent" });

export const SignerAccessCodeCheck = z
  .object({ code: z.string().regex(/^\d{6}$/) })
  .meta({ id: "SignerAccessCodeCheck" });

export const SignerAdoption = z
  .object({
    how: z.enum(["typed", "drawn", "uploaded"]),
    /** The signature as a PNG, base64. */
    signaturePng: z
      .string()
      .min(1)
      .max(Math.ceil((MAXIMUM_MARK_BYTES * 4) / 3) + 4),
    /** The initials as a PNG, base64; null when the signer has no initials fields. */
    initialsPng: z
      .string()
      .min(1)
      .max(Math.ceil((MAXIMUM_MARK_BYTES * 4) / 3) + 4)
      .nullable(),
  })
  .meta({ id: "SignerAdoption" });

export const SignerFinish = z
  .object({
    /** A text field's words or a checkbox's state, by field id. Signatures need no answer. */
    answers: z.record(z.string(), z.union([z.string().max(MAXIMUM_TEXT_ANSWER), z.boolean()])),
  })
  .meta({ id: "SignerFinish" });

export const SignerDecline = z
  .object({ reason: z.string().max(500) })
  .meta({ id: "SignerDecline" });

export const SignerOutcome = z
  .object({ status: z.enum(["signed", "declined"]) })
  .meta({ id: "SignerOutcome" });

/** "jordan@example.com" -> "j*****@example.com": enough to recognise, not enough to harvest. */
export function maskedAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "your email address";
  return `${address.slice(0, 1)}${"*".repeat(Math.max(1, at - 1))}${address.slice(at)}`;
}

export function signerViewBody(
  view: SignerView,
  names: { readonly firmName: string; readonly senderName: string },
): z.infer<typeof SignerRequestView> {
  const { request } = view.detail;
  const disclosure = consentDisclosure(
    { firm: names.firmName, sender: names.senderName },
    view.signer.consentDisclosureVersion ?? undefined,
  );
  return {
    firmName: names.firmName,
    senderName: names.senderName,
    title: request.title,
    message: request.message,
    expiresAt: request.expiresAt,
    signerName: view.signer.name,
    codeSentTo:
      view.signer.attributionLevel === "access-code" ? maskedAddress(view.signer.email) : null,
    needsCode: needsCode(view),
    consented: view.signer.consentedAt !== null,
    adopted: view.signer.signatureObjectKey !== null,
    consent: {
      version: disclosure.version,
      title: disclosure.title,
      paragraphs: [...disclosure.paragraphs],
    },
    fields: fieldsInReadingOrder(
      view.detail.fields.map((field) => ({ ...field, rect: field.rect })),
      view.signer.id,
    ).map((field) => ({
      id: field.id,
      kind: field.kind,
      page: field.page,
      rect: [field.rect[0], field.rect[1], field.rect[2], field.rect[3]],
      required: field.required,
    })),
  };
}
