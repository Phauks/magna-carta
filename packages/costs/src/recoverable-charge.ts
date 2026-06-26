// The generalized recoverable-charge seam. A producer that incurs a billable charge on a matter's
// behalf — a shipping fee, an e-signature send, an outbound message — emits this contract instead of
// reaching into the cost-entry tables itself. Keeping it a pure shape lets any future fee source plug
// in without a code change here; the mapping into cost captures lives downstream.

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
