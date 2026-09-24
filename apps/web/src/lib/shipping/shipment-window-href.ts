/*
 * Where a shipment is read.
 *
 * One function rather than a string built at each call site, because two things depend on the answer
 * agreeing: the register, which opens its window from this parameter, and the redirect at
 * /shipping/[id], which is the address anything outside the register links to. A query parameter
 * rather than a path segment because the window opens OVER the register — the reader is still on the
 * list, and the address says so.
 */
export const SHIPMENT_WINDOW_PARAMETER = "shipment";

export function shipmentWindowHref(shipmentId: string): string {
  return `/shipping?${SHIPMENT_WINDOW_PARAMETER}=${encodeURIComponent(shipmentId)}`;
}
