/*
 * The shipping screens' calls, in one place.
 *
 * Every call goes through the GENERATED client's own functions — no `/api/v1/...` literal is spelled
 * here, which is the point: a hand-written path is a module about to become another mirror of a
 * contract CI already generates and diff-gates, and `pnpm run lint:screen-data` holds the count of
 * those down rather than letting it grow one convenience at a time.
 *
 * What this module adds on top of the generated functions is the IDEMPOTENCY KEY. Every shipping
 * write requires one, and the platform's answer to a double-submit is a key minted per INTENT and
 * reused by every attempt at it (api/write-intent.ts) — a thing a caller holds, not a thing a
 * request shape can supply. So each write here takes the key its caller is holding and puts it on
 * the header the contract asks for.
 */
import {
  problemOutcome,
  requestLine,
  transportOutcome,
  type ApiOutcome,
  type Page,
} from "$lib/api/request.ts";
import {
  shippingConnect,
  shippingCreateShipment,
  shippingDisconnectCarrier,
  shippingLabel,
  shippingListShipments,
  shippingPurchase,
  shippingRateShipment,
  shippingRefund,
  shippingTracking,
} from "@magna-carta/api-client";

/** What a failure is filed under when the client could not even build a request to name. */
const SHIPMENTS_LISTING = "shipments listing";

/** The header the contract requires on every shipping write. */
function idempotently(key: string): { readonly headers: { readonly "idempotency-key": string } } {
  return { headers: { "idempotency-key": key } };
}

export interface ShipmentAddressPayload {
  readonly name: string;
  readonly company: string | null;
  readonly street1: string;
  readonly street2: string | null;
  readonly city: string;
  readonly state: string;
  readonly zip: string;
  readonly country: string;
  readonly phone: string | null;
}

export interface ShipmentRate {
  readonly remoteId: string;
  readonly carrier: string;
  readonly service: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly deliveryDays: number | null;
  readonly estDeliveryDate: string | null;
}

export interface ShipmentRatesAnswer {
  readonly remoteShipmentId: string;
  readonly rates: readonly ShipmentRate[];
}

export interface ShipmentListRow {
  readonly id: string;
  readonly matterRef: string | null;
  readonly status: string;
  readonly recipientName: string | null;
  readonly carrier: string | null;
  readonly service: string | null;
  readonly trackingCode: string | null;
  readonly postageCostMinor: number | null;
  readonly serviceFeeMinor: number | null;
  readonly currency: string | null;
  readonly createdAt: string;
}

/*
 * One page of the register, newest first, in the shape the app's paged list reads.
 *
 * The generated function answers `{ data, error }`; the list reads the platform's `ApiOutcome`, whose
 * failing branches carry the record every failure surface renders from. This is the one translation
 * between them, done here rather than in the screen so the screen has a single shape to handle.
 */
export async function readShipments(
  options: { readonly cursor?: string } = {},
): Promise<ApiOutcome<Page<ShipmentListRow>>> {
  const answer = await shippingListShipments({
    query: options.cursor === undefined ? {} : { cursor: options.cursor },
  });
  // The request line a failure is recorded under comes from the request the client actually made,
  // rather than from a path spelled here: the generated function owns the address, and repeating it
  // would be one more copy of the contract for the failure record's sake alone.
  const line = requestLine("GET", answer.request?.url ?? SHIPMENTS_LISTING);
  if (answer.error !== undefined) return problemOutcome(answer.error, line);
  if (answer.data === undefined) return transportOutcome(line);
  return {
    kind: "ok",
    value: { data: [...answer.data.data], nextCursor: answer.data.nextCursor },
  };
}

export function connectPostageAccount(apiKey: string, idempotencyKey: string) {
  return shippingConnect({ body: { apiKey }, ...idempotently(idempotencyKey) });
}

export function disconnectPostageAccount(idempotencyKey: string) {
  return shippingDisconnectCarrier({ ...idempotently(idempotencyKey) });
}

export function createShipmentDraft(
  draft: {
    readonly matterRef: string | null;
    readonly from: ShipmentAddressPayload;
    readonly to: ShipmentAddressPayload;
    readonly parcel: { readonly weightOz: number };
    readonly options: {
      readonly certifiedMail: boolean;
      readonly returnReceipt: "none" | "electronic" | "physical";
      readonly signatureConfirmation: "none" | "signature" | "adult";
    };
  },
  idempotencyKey: string,
) {
  return shippingCreateShipment({ body: draft, ...idempotently(idempotencyKey) });
}

export function rateShipment(shipmentId: string) {
  return shippingRateShipment({ path: { id: shipmentId } });
}

export function purchaseLabel(
  shipmentId: string,
  choice: {
    readonly remoteShipmentId: string;
    readonly remoteRateId: string;
  },
  idempotencyKey: string,
) {
  return shippingPurchase({
    path: { id: shipmentId },
    body: choice,
    ...idempotently(idempotencyKey),
  });
}

/*
 * A shipment's tracking history.
 *
 * A POST rather than a read because it is a LIVE call to the carrier — the platform holds the events
 * it has been told about, and asking refreshes them. It carries no idempotency key: the contract
 * makes one optional here, and re-asking where a parcel is has no effect to collapse.
 */
export function readTracking(shipmentId: string) {
  return shippingTracking({ path: { id: shipmentId } });
}

/** Void an unused label and reclaim its postage. */
export function refundShipment(shipmentId: string, idempotencyKey: string) {
  return shippingRefund({ path: { id: shipmentId }, ...idempotently(idempotencyKey) });
}

/*
 * The label's bytes, as something a browser can open.
 *
 * Fetched through the generated function rather than linked to by address, for two reasons that
 * happen to agree. The contract's paths live in the generated client and a literal here would be one
 * more copy of one (`pnpm run lint:screen-data`). And the bytes come from the firm's own storage
 * behind the session, so a blob the browser already holds opens without a second authenticated
 * navigation that a pop-up blocker or an expired tab could lose.
 *
 * The caller revokes the URL when it is done with it; an object URL lives until the document goes.
 */
export async function readLabelObjectUrl(shipmentId: string): Promise<string | null> {
  const answer = await shippingLabel({ path: { id: shipmentId } });
  const response = answer.response;
  if (answer.error !== undefined || response === undefined || !response.ok) return null;
  return URL.createObjectURL(await response.blob());
}
