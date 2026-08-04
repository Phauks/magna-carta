import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient } from "@magna-carta/integrations/http";
import { integrationProblem } from "@magna-carta/integrations/problem";
import type { Adapter, AdapterContext, CapabilityDescriptor } from "@magna-carta/integrations/port";
import type { AddressInput, BuyLabelRequest, RateRequest } from "../canonical.ts";
import type { ShippingPort } from "../port.ts";
import {
  classifyError,
  mapAddress,
  mapInsurance,
  mapLabel,
  mapRatedShipment,
  mapRefund,
  mapShipmentOptions,
  mapTrackingEvents,
  networkProblem,
} from "./map.ts";

const DEFAULT_BASE_URL = "https://api.easypost.com/v2";

const descriptor: CapabilityDescriptor = {
  adapterId: "easypost",
  category: "shipping",
  credential: { kind: "apiKey", scope: "firm" },
  operations: {
    validateAddress: { supported: true },
    rateShipment: { supported: true },
    buyLabel: { supported: true },
    getTracking: { supported: true },
    refundLabel: { supported: true },
  },
  passthroughAvailable: true,
};

export interface EasyPostAdapterDeps {
  readonly http: HttpClient;
  readonly baseUrl?: string;
}

export function createEasyPostAdapter(deps: EasyPostAdapterDeps): Adapter<ShippingPort> {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  return {
    descriptor,
    create(context: AdapterContext): ShippingPort {
      const credential = context.credential;
      if (credential === undefined || credential.kind !== "apiKey") {
        throw new Error("EasyPost adapter requires an apiKey credential");
      }
      // EasyPost uses HTTP Basic auth with the API key as the username and an empty password.
      const authHeader = `Basic ${btoa(`${credential.apiKey}:`)}`;
      const headers = { Authorization: authHeader, "Content-Type": "application/json" };

      async function call<T>(
        method: "GET" | "POST",
        path: string,
        body: unknown,
        map: (json: unknown) => T,
      ): Promise<Dispatch<T>> {
        let response;
        try {
          response = await deps.http.request({
            method,
            url: `${baseUrl}${path}`,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch {
          return adapterError(networkProblem());
        }
        if (response.status >= 400) {
          // Title is the status family — never the upstream body (it can echo the auth header).
          return adapterError(
            classifyError(response.status, `EasyPost responded ${response.status}`),
          );
        }
        const json = await response.json();
        try {
          return ok(map(json));
        } catch {
          return adapterError(
            integrationProblem(
              "validation",
              response.status,
              "EasyPost response failed validation",
            ),
          );
        }
      }

      function epAddress(input: AddressInput): Record<string, unknown> {
        return {
          name: input.name,
          ...(input.company != null && { company: input.company }),
          street1: input.street1,
          ...(input.street2 != null && { street2: input.street2 }),
          city: input.city,
          state: input.state,
          zip: input.zip,
          country: input.country,
          ...(input.phone != null && { phone: input.phone }),
        };
      }

      return {
        validateAddress(input: AddressInput) {
          return call(
            "POST",
            "/addresses",
            { address: epAddress(input), verify: ["delivery"] },
            (json) => mapAddress(json as never),
          );
        },
        rateShipment(input: RateRequest) {
          const shipment = {
            to_address: epAddress(input.to),
            from_address: epAddress(input.from),
            parcel: {
              length: input.parcel.lengthIn,
              width: input.parcel.widthIn,
              height: input.parcel.heightIn,
              weight: input.parcel.weightOz,
              ...(input.parcel.predefinedPackage != null && {
                predefined_package: input.parcel.predefinedPackage,
              }),
            },
            options: mapShipmentOptions(input.options),
          };
          return call("POST", "/shipments", { shipment }, (json) =>
            mapRatedShipment(json as never),
          );
        },
        buyLabel(input: BuyLabelRequest) {
          // EasyPost has no idempotency-key facility on any endpoint, so a retried buy is a second
          // real purchase. Double-buy protection therefore lives on our side of the boundary, in
          // the caller's per-shipment purchase claim — never in a header this API would ignore.
          const body = {
            rate: { id: input.remoteRateId },
            label_format: input.labelFormat ?? "PDF",
            ...mapInsurance(input.insuranceAmountMinor),
          };
          return call("POST", `/shipments/${input.remoteShipmentId}/buy`, body, (json) =>
            mapLabel(json as never),
          );
        },
        getTracking(trackingCode: string) {
          return call(
            "GET",
            `/trackers?tracking_code=${encodeURIComponent(trackingCode)}`,
            undefined,
            (json) => {
              const trackers = (json as { trackers?: unknown[] }).trackers ?? [json];
              return mapTrackingEvents(trackers[0] as never);
            },
          );
        },
        refundLabel(remoteShipmentId: string) {
          return call("POST", `/shipments/${remoteShipmentId}/refund`, {}, (json) =>
            mapRefund(json as never),
          );
        },
      };
    },
  };
}
