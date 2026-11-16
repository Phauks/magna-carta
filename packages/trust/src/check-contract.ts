import { z } from "zod";
import { identifierField } from "@magna-carta/identifiers/field";
import { CHECK_FIELD_ALIGNMENTS, CHECK_FIELD_KINDS, CHECK_PAGE_LAYOUTS } from "./check-layout.ts";
import { MAX_TRUST_CHECKS_PER_BATCH } from "./checks.ts";

// Check printing's contract: what its API accepts in a request body and returns in a response, as
// plain zod. Each component is named with zod's own metadata (`.meta({ id })`), which the contract
// emitter reads as the component's name. The route modules in apps/api-worker declare their routes
// over these; path and query parameters stay with the routes.

export const CheckField = z
  .object({
    kind: z.enum(CHECK_FIELD_KINDS),
    xMils: z.number().int(),
    yMils: z.number().int(),
    widthMils: z.number().int(),
    sizePoints: z.number(),
    align: z.enum(CHECK_FIELD_ALIGNMENTS),
  })
  .meta({ id: "TrustCheckField" });

export const CheckStock = z
  .object({
    trustCheckStockId: z.string(),
    version: z.number().int(),
    name: z.string(),
    pageLayout: z.enum(CHECK_PAGE_LAYOUTS),
    fields: z.array(CheckField),
    shiftXMils: z.number().int(),
    shiftYMils: z.number().int(),
    startingCheckNumber: z.number().int(),
    hasScan: z.boolean(),
    savedBy: z.string(),
    savedAt: z.string(),
  })
  .meta({ id: "TrustCheckStock" });

export const CheckToPrint = z
  .object({
    trustMovementId: z.string(),
    payee: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    memo: z.string(),
    effectiveDate: z.string(),
    authorizedBy: z.string().nullable(),
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
    earlierCheckNumbers: z.array(z.number().int()),
  })
  .meta({ id: "TrustCheckToPrint" });

export const CheckStatus = z.enum(["numbered", "printed", "spoiled", "voided"]);

export const RegisterRow = z
  .object({
    trustCheckId: z.string(),
    checkNumber: z.number().int(),
    status: CheckStatus,
    trustMovementId: z.string().nullable(),
    payee: z.string().nullable(),
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    effectiveDate: z.string().nullable(),
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
    memo: z.string().nullable(),
    numberedBy: z.string(),
    numberedAt: z.string(),
    settledReason: z.string().nullable(),
    lastEventAt: z.string().nullable(),
  })
  .meta({ id: "TrustCheckRegisterRow" });

export const ChecksResponse = z
  .object({
    nextCheckNumber: z.number().int(),
    stock: CheckStock.nullable(),
    toPrint: z.array(CheckToPrint),
    register: z.array(RegisterRow),
  })
  .meta({ id: "TrustChecksResponse" });

export const PrintRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    trustMovementIds: z
      .array(identifierField("trustMovement"))
      .min(1)
      .max(MAX_TRUST_CHECKS_PER_BATCH),
  })
  .meta({ id: "PrintTrustChecksRequest" });

export const PrintedCheck = z
  .object({
    trustCheckId: z.string(),
    checkNumber: z.number().int(),
    trustMovementId: z.string(),
    payee: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    effectiveDate: z.string(),
    memo: z.string(),
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
  })
  .meta({ id: "PrintedTrustCheck" });

export const PrintResponse = z
  .object({ stock: CheckStock, checks: z.array(PrintedCheck) })
  .meta({ id: "PrintTrustChecksResponse" });

export const ResultsRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    results: z
      .array(
        z.object({
          trustCheckId: identifierField("trustCheck"),
          outcome: z.enum(["printed", "spoiled"]),
          reason: z.string().max(500).nullish(),
        }),
      )
      .min(1)
      .max(100),
  })
  .meta({ id: "RecordTrustCheckResultsRequest" });

export const VoidRequest = z
  .object({ trustAccountId: identifierField("trustAccount"), reason: z.string().min(1).max(500) })
  .meta({ id: "VoidTrustCheckRequest" });

export const Acknowledgement = z
  .object({ recorded: z.number().int(), checkNumber: z.number().int().nullable() })
  .meta({ id: "TrustCheckAcknowledgement" });

export const SaveStockRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    name: z.string().min(1).max(120),
    pageLayout: z.enum(CHECK_PAGE_LAYOUTS),
    fields: z.array(CheckField).min(1).max(12),
    shiftXMils: z.number().int(),
    shiftYMils: z.number().int(),
    startingCheckNumber: z.number().int().min(1),
    // `keep` holds on to the current version's scan, `remove` drops it, and an image replaces it.
    // The image is base64 of a PNG or JPEG the browser has already straightened.
    scan: z.union([
      z.literal("keep"),
      z.literal("remove"),
      z.object({ imageBase64: z.string().min(1) }),
    ]),
  })
  .meta({ id: "SaveTrustCheckStockRequest" });

export const SaveStockResponse = z
  .object({ stock: CheckStock, nextCheckNumber: z.number().int() })
  .meta({ id: "SaveTrustCheckStockResponse" });
