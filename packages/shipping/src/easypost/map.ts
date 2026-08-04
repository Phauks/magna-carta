import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";
import {
  addressSchema,
  labelSchema,
  ratedShipmentSchema,
  refundResultSchema,
  trackingEventSchema,
  type CanonicalAddress,
  type Label,
  type RatedShipment,
  type RefundResult,
  type ShipmentOptions,
  type TrackingEvent,
} from "../canonical.ts";

// EasyPost returns money as a decimal-dollar string ("7.45"). Convert to integer minor units without
// float drift: parse the two sides of the decimal point separately.
export function dollarsToMinor(amount: string): number {
  const parts = amount.trim().split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const cents = `${frac}00`.slice(0, 2);
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeMinor = Math.abs(Number.parseInt(whole, 10)) * 100;
  return sign * (wholeMinor + Number.parseInt(cents, 10));
}

// The inverse: integer minor units back to the decimal-dollar string EasyPost expects. Built by
// string assembly rather than division-and-toFixed so no binary float ever holds the amount.
export function minorToDollars(amountMinor: number): string {
  const rounded = Math.trunc(amountMinor);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const whole = Math.floor(absolute / 100);
  const cents = absolute % 100;
  return `${sign}${whole}.${String(cents).padStart(2, "0")}`;
}

interface EpRate {
  id: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  delivery_days?: number | null;
  // EasyPost v2 Rate object uses delivery_date (a date string) — not est_delivery_date.
  // est_delivery_days (integer) also appears in responses but is undocumented.
  delivery_date?: string | null;
}

interface EpShipment {
  id: string;
  rates?: EpRate[];
  tracking_code?: string;
  selected_rate?: { carrier: string; service: string; rate: string; currency: string };
  postage_label?: { label_url: string; label_file_type?: string };
}

export function mapRatedShipment(shipment: EpShipment): RatedShipment {
  return ratedShipmentSchema.parse({
    remoteId: shipment.id,
    raw: shipment,
    rates: (shipment.rates ?? []).map((rate) => ({
      remoteId: rate.id,
      carrier: rate.carrier,
      service: rate.service,
      amountMinor: dollarsToMinor(rate.rate),
      currency: rate.currency,
      deliveryDays: rate.delivery_days ?? null,
      estDeliveryDate: rate.delivery_date ?? null,
    })),
  });
}

export function mapLabel(shipment: EpShipment): Label {
  const selected = shipment.selected_rate;
  if (
    selected === undefined ||
    shipment.postage_label === undefined ||
    shipment.tracking_code === undefined
  ) {
    throw new Error("EasyPost shipment is not in a bought state");
  }
  return labelSchema.parse({
    remoteId: shipment.id,
    raw: shipment,
    carrier: selected.carrier,
    service: selected.service,
    trackingCode: shipment.tracking_code,
    labelUrl: shipment.postage_label.label_url,
    labelFormat: shipment.postage_label.label_file_type ?? "PDF",
    costMinor: dollarsToMinor(selected.rate),
    currency: selected.currency,
  });
}

interface EpAddress {
  id: string;
  name?: string | null;
  company?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string | null;
  residential?: boolean | null;
  verifications?: { delivery?: { success: boolean } };
}

export function mapAddress(address: EpAddress): CanonicalAddress {
  return addressSchema.parse({
    remoteId: address.id,
    raw: address,
    name: address.name ?? "",
    company: address.company ?? null,
    street1: address.street1,
    street2: address.street2 ?? null,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    phone: address.phone ?? null,
    residential: address.residential ?? null,
    verified: address.verifications?.delivery?.success === true,
  });
}

interface EpTracker {
  tracking_details?: {
    status?: string;
    datetime?: string | null;
    message?: string | null;
    tracking_location?: { city?: string | null; state?: string | null } | null;
  }[];
}

export function mapTrackingEvents(tracker: EpTracker | undefined): TrackingEvent[] {
  return (tracker?.tracking_details ?? []).map((detail, index) =>
    trackingEventSchema.parse({
      remoteId: `${detail.status ?? "event"}:${detail.datetime ?? index}`,
      raw: detail,
      status: detail.status ?? "unknown",
      occurredAt: detail.datetime ?? null,
      location: locationOf(detail.tracking_location),
      message: detail.message ?? null,
    }),
  );
}

function locationOf(
  loc: { city?: string | null; state?: string | null } | null | undefined,
): string | null {
  if (loc === null || loc === undefined) return null;
  const parts = [loc.city, loc.state].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function mapRefund(shipment: { id: string; refund_status?: string }): RefundResult {
  return refundResultSchema.parse({
    remoteId: shipment.id,
    raw: shipment,
    status: shipment.refund_status ?? "submitted",
  });
}

// Certified mail / return receipt / signature → EasyPost `options`. Only emit keys the caller
// actually set, so an unset option never overrides an EasyPost default.
//
// EasyPost `return_receipt` is a boolean (not a per-service string); our canonical model uses
// "electronic" | "physical" | "none" to distinguish USPS service levels — both non-none values
// map to true here. USPS itself determines the actual service from the shipment context.
export function mapShipmentOptions(options: ShipmentOptions | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (options === undefined) return out;
  if (options.certifiedMail) out.certified_mail = true;
  if (options.returnReceipt && options.returnReceipt !== "none") out.return_receipt = true;
  if (options.signatureConfirmation && options.signatureConfirmation !== "none") {
    out.delivery_confirmation =
      options.signatureConfirmation === "adult" ? "ADULT_SIGNATURE" : "SIGNATURE";
  }
  return out;
}

// Insurance is NOT an EasyPost `options` key and is not in minor units: it is a top-level
// decimal-dollar string on the buy request ("249.99"), declaring the value to insure. It rides the
// buy call rather than a follow-up insure call so a parcel is never briefly bought-but-uninsured —
// if the buy fails, nothing is charged and nothing is covered, which is the state the caller can
// reason about. Zero, null, and undefined all mean "no insurance", so the key is omitted entirely
// (sending "0.00" would be a request to insure nothing).
export function mapInsurance(amountMinor: number | null | undefined): Record<string, string> {
  if (amountMinor == null || amountMinor <= 0) return {};
  return { insurance: minorToDollars(amountMinor) };
}

// HTTP status → the one integration taxonomy. Title is caller-safe; the upstream body is never
// spliced into detail (it can echo auth headers / tokens).
export function classifyError(status: number, title: string): IntegrationProblem {
  if (status === 401 || status === 403) return integrationProblem("auth", status, title);
  if (status === 429) return integrationProblem("rate_limit", status, title);
  if (status >= 400 && status < 500) return integrationProblem("validation", status, title);
  return integrationProblem("upstream", status, title);
}

export function networkProblem(): IntegrationProblem {
  return integrationProblem("network", 0, "EasyPost request failed");
}
