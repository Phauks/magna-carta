import { z } from "zod";

import { SIGNING_EVENT_KINDS, type SigningEventKind } from "@magna-carta/signing/esign";
import {
  OFFERED_ATTRIBUTION,
  SIGNING_FIELD_KINDS,
  type SigningFieldKind,
} from "@magna-carta/signing/request";
import type { SigningRequestDetail as StoredDetail } from "./request-service.ts";
import { MAXIMUM_FIELDS, MAXIMUM_SIGNERS } from "./statements.ts";

// What the member routes for a signing request accept and return, as plain zod named with
// `.meta({ id })`, so the route module declares its routes over these without restating a field
// (docs/conventions/api.md, _Where a contract shape lives_).

const FIELD_KINDS = SIGNING_FIELD_KINDS as readonly [SigningFieldKind, ...SigningFieldKind[]];
const EVENT_KINDS = SIGNING_EVENT_KINDS as readonly [SigningEventKind, ...SigningEventKind[]];
const OFFERED = OFFERED_ATTRIBUTION as readonly [
  (typeof OFFERED_ATTRIBUTION)[number],
  ...(typeof OFFERED_ATTRIBUTION)[number][],
];

// A field's place on its page in PDF points: left, bottom, right, top. Declared as a tuple for the
// code and given plain array items for the contract, which every client generator reads.
export const Rect = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .openapi({ type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 });

export const SigningRequestSummary = z
  .object({
    id: z.string(),
    fileId: z.string(),
    fileVersionId: z.string(),
    title: z.string(),
    status: z.enum(["draft", "sent", "completed", "declined", "voided", "expired"]),
    sentAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    signerCount: z.number().int(),
    signedCount: z.number().int(),
  })
  .meta({ id: "SigningRequestSummary" });

export const SigningRequestList = z
  .object({ requests: z.array(SigningRequestSummary) })
  .meta({ id: "SigningRequestList" });

export const SigningRequestDetail = z
  .object({
    id: z.string(),
    matterId: z.string(),
    fileId: z.string(),
    fileVersionId: z.string(),
    documentHashSha256: z.string().nullable(),
    title: z.string(),
    subject: z.string(),
    message: z.string(),
    order: z.enum(["in-order", "all-at-once"]),
    status: z.enum(["draft", "sent", "completed", "declined", "voided", "expired"]),
    expiresAt: z.string(),
    remindEveryDays: z.number().int().nullable(),
    lastRemindedAt: z.string().nullable(),
    createdBy: z.string(),
    sentAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    sealedAt: z.string().nullable(),
    voidedReason: z.string().nullable(),
    signers: z.array(
      z.object({
        id: z.string(),
        position: z.number().int(),
        name: z.string(),
        email: z.string(),
        attribution: z.enum(OFFERED),
        userId: z.string().nullable(),
        status: z.enum(["waiting", "notified", "opened", "signed", "declined"]),
        notifiedAt: z.string().nullable(),
        openedAt: z.string().nullable(),
        signedAt: z.string().nullable(),
        declinedAt: z.string().nullable(),
      }),
    ),
    fields: z.array(
      z.object({
        id: z.string(),
        signerId: z.string(),
        kind: z.enum(FIELD_KINDS),
        page: z.number().int(),
        rect: Rect,
        required: z.boolean(),
      }),
    ),
    events: z.array(
      z.object({
        kind: z.enum(EVENT_KINDS),
        at: z.string(),
        signerId: z.string().nullable(),
        actor: z.string().nullable(),
        observedIp: z.string().nullable(),
        detail: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: "SigningRequestDetail" });

export const SaveSigningDraftRequest = z
  .object({
    subject: z.string().trim().min(1).max(200),
    message: z.string().max(4000),
    order: z.enum(["in-order", "all-at-once"]),
    expiresAt: z.iso.datetime(),
    remindEveryDays: z.number().int().min(1).max(30).nullable(),
    signers: z
      .array(
        z.object({
          key: z.string().min(1).max(64),
          name: z.string().trim().max(200),
          email: z.string().trim().max(320),
          attribution: z.enum(OFFERED),
          userId: z.string().optional(),
        }),
      )
      .max(MAXIMUM_SIGNERS),
    fields: z
      .array(
        z.object({
          signerKey: z.string().min(1).max(64),
          kind: z.enum(FIELD_KINDS),
          page: z.number().int().min(1).max(100_000),
          rect: Rect,
          required: z.boolean(),
        }),
      )
      .max(MAXIMUM_FIELDS),
  })
  .meta({ id: "SaveSigningDraftRequest" });

export const CancelSigningRequest = z
  .object({ reason: z.string().max(500) })
  .meta({ id: "CancelSigningRequest" });

/** A stored request as the routes answer it: never a secret, a code or an image key. */
export function signingRequestBody(detail: StoredDetail): z.infer<typeof SigningRequestDetail> {
  const { request } = detail;
  return {
    id: request.id,
    matterId: request.matterId,
    fileId: request.fileId,
    fileVersionId: request.fileVersionId,
    documentHashSha256: request.documentHashSha256,
    title: request.title,
    subject: request.subject,
    message: request.message,
    order: request.signingOrder,
    status: request.status,
    expiresAt: request.expiresAt,
    remindEveryDays: request.remindEveryDays,
    lastRemindedAt: request.lastRemindedAt,
    createdBy: request.createdByUserId,
    sentAt: request.sentAt,
    completedAt: request.completedAt,
    sealedAt: request.sealedAt,
    voidedReason: request.voidedReason,
    signers: detail.signers.map((signer) => ({
      id: signer.id,
      position: signer.position,
      name: signer.name,
      email: signer.email,
      attribution: signer.attributionLevel as "email-link" | "access-code" | "firm-authenticated",
      userId: signer.userId,
      status: signer.status,
      notifiedAt: signer.notifiedAt,
      openedAt: signer.openedAt,
      signedAt: signer.signedAt,
      declinedAt: signer.declinedAt,
    })),
    fields: detail.fields.map((field) => ({
      id: field.id,
      signerId: field.signerId,
      kind: field.kind,
      page: field.page,
      rect: [...field.rect] as [number, number, number, number],
      required: field.required,
    })),
    events: detail.events.map((event) => ({
      kind: event.kind,
      at: event.at,
      signerId: event.signerId,
      actor: event.actor,
      observedIp: event.observedIp,
      detail: event.detail,
    })),
  };
}
