import type {
  DocumentId,
  FirmId,
  LedgerAccountId,
  LedgerEntryId,
  LedgerLineId,
  MatterId,
} from "../src/types.ts";

declare const documentId: DocumentId;
declare const firmId: FirmId;
declare const matterId: MatterId;
declare const ledgerAccountId: LedgerAccountId;
declare const ledgerEntryId: LedgerEntryId;
declare const ledgerLineId: LedgerLineId;

// @ts-expect-error - a DocumentId must not be assignable to a MatterId (distinct brands)
export const wrongBrand: MatterId = documentId;

// @ts-expect-error - a FirmId must not be assignable to a MatterId either
export const wrongBrand2: MatterId = firmId;

// @ts-expect-error - a raw string must not be assignable to a MatterId without validation
export const rawString: MatterId = "matter_V1StGXR8Z5jdHiopq2Cf";

// @ts-expect-error - a LedgerAccountId must not be assignable to a LedgerLineId (distinct brands)
export const wrongLedgerBrand: LedgerLineId = ledgerAccountId;

// @ts-expect-error - a LedgerLineId must not be assignable to a LedgerAccountId either
export const wrongLedgerBrand2: LedgerAccountId = ledgerLineId;

// @ts-expect-error - a LedgerEntryId must not be assignable to a LedgerAccountId (distinct brands)
export const wrongLedgerBrand3: LedgerAccountId = ledgerEntryId;

// @ts-expect-error - a LedgerEntryId must not be assignable to a LedgerLineId either
export const wrongLedgerBrand4: LedgerLineId = ledgerEntryId;

// POSITIVE control: a branded id flows into a plain string (so handles can be used as DB values / URLs).
export const asString: string = matterId;
