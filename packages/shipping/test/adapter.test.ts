import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest } from "../src/easypost/http.ts";
import { createEasyPostAdapter } from "../src/easypost/adapter.ts";
import type { ShippingPort } from "../src/port.ts";

function fakeHttp(handler: (req: HttpRequest) => { status: number; body: unknown }): HttpClient {
  return {
    async request(req) {
      const { status, body } = handler(req);
      return { status, json: async () => body };
    },
  };
}

const ADDRESS = {
  name: "Jane",
  street1: "1 Main St",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
};

function portWith(http: HttpClient): ShippingPort {
  return createEasyPostAdapter({ http }).create({
    credential: { kind: "apiKey", apiKey: "ezk_test" },
  });
}

describe("EasyPost adapter", () => {
  it("declares a firm-scoped api-key descriptor with all operations", () => {
    const descriptor = createEasyPostAdapter({
      http: fakeHttp(() => ({ status: 200, body: {} })),
    }).descriptor;
    expect(descriptor.adapterId).toBe("easypost");
    expect(descriptor.category).toBe("shipping");
    expect(descriptor.credential).toEqual({ kind: "apiKey", scope: "firm" });
    expect(descriptor.operations["buyLabel"]?.supported).toBe(true);
  });

  it("rateShipment posts a shipment and returns canonical rates", async () => {
    let seen: HttpRequest | undefined;
    const port = portWith(
      fakeHttp((req) => {
        seen = req;
        return {
          status: 201,
          body: {
            id: "shp_1",
            rates: [
              { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
            ],
          },
        };
      }),
    );
    const result = await port.rateShipment({
      from: ADDRESS,
      to: ADDRESS,
      parcel: { weightOz: 10 },
      options: { certifiedMail: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rates[0]?.amountMinor).toBe(745);
    expect(seen?.headers.Authorization).toMatch(/^Basic /);
    expect(seen?.url).toContain("/shipments");
    expect(JSON.parse(seen?.body ?? "{}").shipment.options).toEqual({ certified_mail: true });
  });

  it("maps a 401 into a typed adapter-error, not a throw", async () => {
    const port = portWith(
      fakeHttp(() => ({ status: 401, body: { error: { message: "bad key" } } })),
    );
    const result = await port.rateShipment({
      from: ADDRESS,
      to: ADDRESS,
      parcel: { weightOz: 10 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("adapter-error");
      expect(result.problem?.category).toBe("auth");
    }
  });

  it("buyLabel posts the chosen rate and returns a canonical label", async () => {
    const port = portWith(
      fakeHttp(() => ({
        status: 200,
        body: {
          id: "shp_1",
          tracking_code: "9400",
          selected_rate: { carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
          postage_label: { label_url: "https://ep/l.pdf", label_file_type: "application/pdf" },
        },
      })),
    );
    const result = await port.buyLabel({ remoteShipmentId: "shp_1", remoteRateId: "rate_1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trackingCode).toBe("9400");
  });

  it("getTracking with an empty trackers list returns ok([]), not a throw", async () => {
    const port = portWith(
      fakeHttp(() => ({
        status: 200,
        body: { trackers: [] },
      })),
    );
    const result = await port.getTracking("9400111899223461892");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("rateShipment with a malformed rate response yields a validation adapter-error, not a throw", async () => {
    const port = portWith(
      fakeHttp(() => ({
        status: 200,
        // Missing required fields: rates[0] has no `id` or `rate`
        body: {
          id: "shp_bad",
          rates: [{ carrier: "USPS", service: "Priority", currency: "USD" }],
        },
      })),
    );
    const result = await port.rateShipment({
      from: ADDRESS,
      to: ADDRESS,
      parcel: { weightOz: 10 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("adapter-error");
      expect(result.problem?.category).toBe("validation");
    }
  });
});
