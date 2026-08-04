import { z } from "zod";
import { canonicalRecordSchema } from "@magna-carta/integrations/canonical";

// Amounts are integer minor units (cents) + an ISO-4217 currency — no floats cross the boundary.
const moneyFields = {
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
};

export const addressSchema = canonicalRecordSchema({
  name: z.string(),
  company: z.string().nullable(),
  street1: z.string(),
  street2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string(), // ISO-3166 alpha-2
  phone: z.string().nullable(),
  residential: z.boolean().nullable(),
  verified: z.boolean(),
});
export type CanonicalAddress = z.infer<typeof addressSchema>;

export const rateSchema = canonicalRecordSchema({
  carrier: z.string(),
  service: z.string(),
  ...moneyFields,
  deliveryDays: z.number().int().nullable(),
  estDeliveryDate: z.string().nullable(),
});
export type Rate = z.infer<typeof rateSchema>;

// remoteId is the EasyPost shipment id; buyLabel needs it plus a chosen rate's remoteId.
export const ratedShipmentSchema = canonicalRecordSchema({
  rates: z.array(rateSchema),
});
export type RatedShipment = z.infer<typeof ratedShipmentSchema>;

export const labelSchema = canonicalRecordSchema({
  carrier: z.string(),
  service: z.string(),
  trackingCode: z.string(),
  labelUrl: z.string(), // EasyPost's URL is transient; the worker copies the bytes to R2
  labelFormat: z.string(), // "PDF" | "ZPL" | "PNG"
  costMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type Label = z.infer<typeof labelSchema>;

export const trackingEventSchema = canonicalRecordSchema({
  status: z.string(),
  occurredAt: z.string().nullable(),
  location: z.string().nullable(),
  message: z.string().nullable(),
});
export type TrackingEvent = z.infer<typeof trackingEventSchema>;

export const refundResultSchema = canonicalRecordSchema({
  status: z.string(), // "submitted" | "refunded" | "rejected"
});
export type RefundResult = z.infer<typeof refundResultSchema>;

// --- Request inputs (our shapes; not canonical records) ---

export interface AddressInput {
  readonly name: string;
  readonly company?: string | null;
  readonly street1: string;
  readonly street2?: string | null;
  readonly city: string;
  readonly state: string;
  readonly zip: string;
  readonly country: string;
  readonly phone?: string | null;
}

export interface ParcelInput {
  readonly lengthIn?: number;
  readonly widthIn?: number;
  readonly heightIn?: number;
  readonly weightOz: number;
  readonly predefinedPackage?: string | null;
}

export interface ShipmentOptions {
  readonly certifiedMail?: boolean;
  readonly returnReceipt?: "none" | "electronic" | "physical";
  readonly signatureConfirmation?: "none" | "signature" | "adult";
  readonly insuranceAmountMinor?: number | null;
}

export interface RateRequest {
  readonly from: AddressInput;
  readonly to: AddressInput;
  readonly parcel: ParcelInput;
  readonly options?: ShipmentOptions;
}

export interface BuyLabelRequest {
  readonly remoteShipmentId: string;
  readonly remoteRateId: string;
  readonly labelFormat?: "PDF" | "ZPL" | "PNG";
  // The declared value to insure, in integer minor units, carried from the draft's ShipmentOptions.
  // The adapter converts it to the carrier's own representation; omitted/zero means no insurance.
  readonly insuranceAmountMinor?: number | null;
}
