import type { DocumentId, FirmId, MatterId } from "../src/types.ts";

declare const documentId: DocumentId;
declare const firmId: FirmId;
declare const matterId: MatterId;

// @ts-expect-error - a DocumentId must not be assignable to a MatterId (distinct brands)
export const wrongBrand: MatterId = documentId;

// @ts-expect-error - a FirmId must not be assignable to a MatterId either
export const wrongBrand2: MatterId = firmId;

// @ts-expect-error - a raw string must not be assignable to a MatterId without validation
export const rawString: MatterId = "mat_V1StGXR8Z5jdHiopq2Cf";

// POSITIVE control: a branded id flows into a plain string (so handles can be used as DB values / URLs).
export const asString: string = matterId;
