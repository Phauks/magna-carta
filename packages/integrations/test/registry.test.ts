import { describe, expect, it } from "vitest";
import type { Credential, CredentialStore } from "../src/credentials.ts";
import type {
  ConnectionLookup,
  ConnectionStore,
  IntegrationConnection,
} from "../src/connection.ts";
import type { Adapter, CapabilityDescriptor } from "../src/port.ts";
import { createIntegrationRegistry, requireCapability } from "../src/registry.ts";

interface EchoPort {
  echo(): string;
}

function makeAdapter(descriptor: CapabilityDescriptor): Adapter<EchoPort> {
  return { descriptor, create: () => ({ echo: () => descriptor.adapterId }) };
}

const credentialLess: CapabilityDescriptor = {
  adapterId: "free",
  category: "free-category",
  credential: { kind: "none" },
  operations: { echo: { supported: true } },
  passthroughAvailable: false,
};

const credentialed: CapabilityDescriptor = {
  adapterId: "paid",
  category: "paid-category",
  credential: { kind: "oauth", scope: "user" },
  operations: { echo: { supported: true } },
  passthroughAvailable: false,
};

class FakeConnectionStore implements ConnectionStore {
  constructor(private readonly connection: IntegrationConnection | null) {}
  async getConnection(_lookup: ConnectionLookup): Promise<IntegrationConnection | null> {
    return this.connection;
  }
}

class FakeCredentialStore implements CredentialStore {
  constructor(private readonly credential: Credential | null) {}
  async get(_ref: string): Promise<Credential | null> {
    return this.credential;
  }
  async put(): Promise<void> {}
}

const connectedRow: IntegrationConnection = {
  id: "integrationConnection_1",
  category: "paid-category",
  adapterId: "paid",
  scope: "user",
  principalRef: "user_1",
  credentialRef: "ref-1",
  status: "connected",
  capabilitySnapshot: credentialed,
};

describe("createIntegrationRegistry.resolve", () => {
  it("resolves a credential-less adapter with no stores", async () => {
    const registry = createIntegrationRegistry();
    registry.register(makeAdapter(credentialLess));
    const result = await registry.resolve<EchoPort>("free-category", { firmId: "firm_1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.port.echo()).toBe("free");
  });

  it("returns not-connected for an unregistered category", async () => {
    const registry = createIntegrationRegistry();
    const result = await registry.resolve<EchoPort>("missing", { firmId: "firm_1" });
    expect(result).toEqual({ ok: false, reason: "not-connected" });
  });

  it("resolves a credentialed adapter when a healthy connection + credential exist", async () => {
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(connectedRow),
      credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
    });
    registry.register(makeAdapter(credentialed));
    const result = await registry.resolve<EchoPort>("paid-category", {
      firmId: "firm_1",
      userId: "user_1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.port.echo()).toBe("paid");
  });

  it("returns not-connected when the connection is missing or unusable", async () => {
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(null),
      credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
    });
    registry.register(makeAdapter(credentialed));
    const result = await registry.resolve<EchoPort>("paid-category", {
      firmId: "firm_1",
      userId: "user_1",
    });
    expect(result).toEqual({ ok: false, reason: "not-connected" });
  });
});

describe("requireCapability", () => {
  it("passes a supported operation and rejects an unsupported one", () => {
    const resolved = { port: { echo: () => "x" }, descriptor: credentialLess };
    expect(requireCapability(resolved, "echo").ok).toBe(true);
    expect(requireCapability(resolved, "missing")).toEqual({
      ok: false,
      reason: "capability-unsupported",
    });
  });
});
