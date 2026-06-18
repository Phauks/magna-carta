import type { Dispatch } from "@magna-carta/integrations/dispatch";
import type {
  AddressInput,
  BuyLabelRequest,
  CanonicalAddress,
  Label,
  RateRequest,
  RatedShipment,
  RefundResult,
  TrackingEvent,
} from "./canonical.ts";

// Named in our vocabulary, not EasyPost's. Every method returns a typed Dispatch so an adapter
// maps a vendor error into a first-class `adapter-error` rather than throwing.
export interface ShippingPort {
  validateAddress(input: AddressInput): Promise<Dispatch<CanonicalAddress>>;
  rateShipment(input: RateRequest): Promise<Dispatch<RatedShipment>>;
  buyLabel(input: BuyLabelRequest): Promise<Dispatch<Label>>;
  getTracking(trackingCode: string): Promise<Dispatch<readonly TrackingEvent[]>>;
  refundLabel(remoteShipmentId: string): Promise<Dispatch<RefundResult>>;
}
