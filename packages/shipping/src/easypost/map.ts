import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";
import type {
  CanonicalAddress,
  Label,
  RatedShipment,
  RefundResult,
  ShipmentOptions,
  TrackingEvent,
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
  return {
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
  };
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
  return {
    remoteId: shipment.id,
    raw: shipment,
    carrier: selected.carrier,
    service: selected.service,
    trackingCode: shipment.tracking_code,
    labelUrl: shipment.postage_label.label_url,
    labelFormat: shipment.postage_label.label_file_type ?? "application/pdf",
    costMinor: dollarsToMinor(selected.rate),
    currency: selected.currency,
  };
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
  return {
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
  };
}

interface EpTracker {
  tracking_details?: {
    status?: string;
    datetime?: string | null;
    message?: string | null;
    tracking_location?: { city?: string | null; state?: string | null } | null;
  }[];
}

export function mapTrackingEvents(tracker: EpTracker): TrackingEvent[] {
  return (tracker.tracking_details ?? []).map((detail, index) => ({
    remoteId: `${detail.status ?? "event"}:${detail.datetime ?? index}`,
    raw: detail,
    status: detail.status ?? "unknown",
    occurredAt: detail.datetime ?? null,
    location: locationOf(detail.tracking_location),
    message: detail.message ?? null,
  }));
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
  return {
    remoteId: shipment.id,
    raw: shipment,
    status: shipment.refund_status ?? "submitted",
  };
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
