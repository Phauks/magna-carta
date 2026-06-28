// The generalized recoverable-charge seam. A producer that incurs a billable charge on a matter's
// behalf — a shipping fee, an e-signature send, an outbound message — emits this contract instead of
// reaching into the cost-entry tables itself. Keeping it a pure shape lets any future fee source plug
// in without a code change here; the mapping into cost captures lives downstream.

// Type-only import: the mapping only needs CaptureCostInput's SHAPE, never its runtime functions, so
// `import type` keeps this module free of a runtime dependency on cost-entry-service (avoiding an
// import cycle and keeping recoverable-charge a leaf at runtime).
import type { CaptureCostInput } from "./cost-entry-service.ts";
import { shouldRecover } from "./recovery-policy.ts";

// One charged item. `category` is an OPEN string so a new fee category needs no edit to this union;
// `kind` is the CLOSED distinction that drives recovery: a `pass_through` is a third-party
// disbursement the firm fronts and always bills the client; a `platform_fee` is a Magna-Carta-absorbed
// fee (e-signature, messaging, shipping handling) the firm MAY choose to pass on under firm policy.
export interface RecoverableChargeLine {
  category: string;
  // Integer minor units (e.g. cents) in the event's `currency`; never a float. Validated on mapping.
  amountMinor: number;
  kind: "pass_through" | "platform_fee";
  description: string;
}

// A producer's emission: one or more charged lines tied to a matter (or `null` when not yet matter-
// attributed), carrying the currency and the source/idempotency refs the consumer needs to map the
// lines into cost captures exactly once.
export interface RecoverableChargeEvent {
  matterRef: string | null;
  currency: string;
  sourceRef: string;
  idempotencyKey: string;
  lines: RecoverableChargeLine[];
}

// Maps a producer's event into the cost captures the consumer commits. Pure: `incurredDate` (a
// calendar date the entry is effective-dated on) is supplied by the caller from its clock — this
// function reads no time and holds no state. `policy(category)` answers whether the firm recovers an
// absorbed platform fee for that category; a pass_through line is always recovered (see shouldRecover),
// so only platform-fee lines consult the policy. A line that is not recovered is skipped.
//
// A `null` matterRef is a firm-administrative charge with nowhere to disburse, so nothing is emitted —
// the early return also narrows matterRef to a non-null string for every input built below (real, not
// a cast: CaptureCostInput.matterId is non-null).
export function chargeToCaptureInputs(
  event: RecoverableChargeEvent,
  policy: (category: string) => boolean,
  incurredDate: string,
): CaptureCostInput[] {
  if (event.matterRef === null) {
    return [];
  }
  const matterId = event.matterRef;

  const inputs: CaptureCostInput[] = [];
  for (const line of event.lines) {
    if (!shouldRecover(line, policy(line.category))) {
      continue;
    }
    inputs.push({
      source: "recovery",
      disbursementClass: "hard",
      billable: true,
      recoveryCategory: line.category,
      // Per-line composite ref, NOT the bare sourceRef. The DB has a unique index on recovery_ref
      // ALONE, so a multi-line event (postage + handling fee) needs a distinct ref per line or the
      // second insert collides. `${sourceRef}:${category}` is stable across queue redelivery (the
      // unique index is the idempotency floor: a redelivered event re-derives identical refs and the
      // double-insert is blocked) and assumes at most one line per category per event — our producer
      // adapters honour that invariant.
      recoveryRef: `${event.sourceRef}:${line.category}`,
      matterId,
      incurredDate,
      amountMinor: line.amountMinor,
      currency: event.currency,
      description: line.description,
    });
  }
  return inputs;
}
