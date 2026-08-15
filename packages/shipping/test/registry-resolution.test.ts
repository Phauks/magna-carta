import type { ConnectionStore } from "@magna-carta/integrations/connection";
import {
  unbuiltCredentialStore,
  type Credential,
  type CredentialStore,
} from "@magna-carta/integrations/credentials";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createIntegrationRegistry, requireCapability } from "@magna-carta/integrations/registry";
import { describe, expect, it } from "vitest";
import { createEasyPostAdapter } from "../src/easypost/adapter.ts";
import type { ShippingPort } from "../src/port.ts";

const http: HttpClient = {
  async request() {
    return {
      status: 201,
      json: async () => ({
        id: "shp_1",
        rates: [
          { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
        ],
      }),
    };
  },
};

const descriptor = createEasyPostAdapter({ http }).descriptor;

const connectionStore: ConnectionStore = {
  async getConnection(lookup) {
    if (lookup.category !== "shipping") return null;
    return {
      id: "integrationConnection_1",
      category: "shipping",
      adapterId: "easypost",
      scope: "firm",
      principalRef: lookup.firmId,
      credentialRef: "ref_1",
      status: "connected",
      capabilitySnapshot: descriptor,
    };
  },
};

const credentialStore: CredentialStore = {
  async get(): Promise<Credential | null> {
    return { kind: "apiKey", apiKey: "ezk_test" };
  },
  async put() {},
};

const ADDRESS = {
  name: "Jane",
  street1: "1 Main St",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
};

describe("registry resolution of the shipping adapter", () => {
  it("resolves a connected firm to a working ShippingPort", async () => {
    const registry = createIntegrationRegistry({ connectionStore, credentialStore });
    registry.register(createEasyPostAdapter({ http }));
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: "firm_1" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const rated = await resolved.value.port.rateShipment({
        from: ADDRESS,
        to: ADDRESS,
        parcel: { weightOz: 8 },
      });
      expect(rated.ok).toBe(true);
    }
  });

  it("returns not-connected for a firm with no connection", async () => {
    const empty: ConnectionStore = {
      async getConnection() {
        return null;
      },
    };
    const registry = createIntegrationRegistry({ connectionStore: empty, credentialStore });
    registry.register(createEasyPostAdapter({ http }));
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: "firm_x" });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toBe("not-connected");
  });

  it("reports the unbuilt credential read rather than an unconnected account", async () => {
    // The connection row says the firm connected its postage account; the credential read that
    // would produce its key does not exist. Reporting "not connected" here would tell the firm to
    // do again the thing it already did.
    const registry = createIntegrationRegistry({
      connectionStore,
      credentialStore: unbuiltCredentialStore,
    });
    registry.register(createEasyPostAdapter({ http }));
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: "firm_1" });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toBe("credential-store-not-implemented");
  });

  it("gates an unsupported operation name via the descriptor", async () => {
    const registry = createIntegrationRegistry({ connectionStore, credentialStore });
    registry.register(createEasyPostAdapter({ http }));
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: "firm_1" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const gate = requireCapability(resolved.value, "schedulePickup");
      expect(gate.ok).toBe(false);
    }
  });
});
