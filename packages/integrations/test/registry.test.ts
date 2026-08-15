import { describe, expect, it } from "vitest";
import {
  unbuiltCredentialStore,
  type Credential,
  type CredentialStore,
} from "../src/credentials.ts";
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

  it("rejects a user-scoped resolve when userId is absent (no firm-wide fallback)", async () => {
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(connectedRow),
      credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
    });
    registry.register(makeAdapter(credentialed));
    expect(await registry.resolve<EchoPort>("paid-category", { firmId: "firm_1" })).toEqual({
      ok: false,
      reason: "not-connected",
    });
  });

  it("rejects disabled and needs_reauth connections but resolves a degraded one", async () => {
    for (const status of ["disabled", "needs_reauth"] as const) {
      const registry = createIntegrationRegistry({
        connectionStore: new FakeConnectionStore({ ...connectedRow, status }),
        credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
      });
      registry.register(makeAdapter(credentialed));
      expect(
        await registry.resolve<EchoPort>("paid-category", { firmId: "firm_1", userId: "user_1" }),
      ).toEqual({ ok: false, reason: "not-connected" });
    }
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore({ ...connectedRow, status: "degraded" }),
      credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
    });
    registry.register(makeAdapter(credentialed));
    const result = await registry.resolve<EchoPort>("paid-category", {
      firmId: "firm_1",
      userId: "user_1",
    });
    expect(result.ok).toBe(true);
  });

  it("returns not-connected when a healthy connection has no stored credential", async () => {
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(connectedRow),
      credentialStore: new FakeCredentialStore(null),
    });
    registry.register(makeAdapter(credentialed));
    expect(
      await registry.resolve<EchoPort>("paid-category", { firmId: "firm_1", userId: "user_1" }),
    ).toEqual({ ok: false, reason: "not-connected" });
  });

  it("reports an unbuilt credential read as its own outcome, not as not-connected", async () => {
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(connectedRow),
      credentialStore: unbuiltCredentialStore,
    });
    registry.register(makeAdapter(credentialed));
    expect(
      await registry.resolve<EchoPort>("paid-category", { firmId: "firm_1", userId: "user_1" }),
    ).toEqual({ ok: false, reason: "credential-store-not-implemented" });
  });

  it("reports the unbuilt credential read even when nothing is connected", async () => {
    // The connection row is what "not connected" is about, and it is absent here — but the answer
    // is still the seam, because connecting one could not help: the key would have nowhere to go.
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(null),
      credentialStore: unbuiltCredentialStore,
    });
    registry.register(makeAdapter(credentialed));
    expect(
      await registry.resolve<EchoPort>("paid-category", { firmId: "firm_1", userId: "user_1" }),
    ).toEqual({ ok: false, reason: "credential-store-not-implemented" });
  });

  it("still resolves a credential-less adapter when the credential read is unbuilt", async () => {
    // A credential-less adapter never asks for a credential, so an unbuilt read must not take the
    // catalog-only integrations down with the credentialed ones.
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(null),
      credentialStore: unbuiltCredentialStore,
    });
    registry.register(makeAdapter(credentialLess));
    const result = await registry.resolve<EchoPort>("free-category", { firmId: "firm_1" });
    expect(result.ok).toBe(true);
  });

  it("resolves with the connection's capability snapshot, not the adapter's descriptor", async () => {
    const snapshot: CapabilityDescriptor = {
      ...credentialed,
      operations: { echo: { supported: true }, extra: { supported: true } },
    };
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore({ ...connectedRow, capabilitySnapshot: snapshot }),
      credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
    });
    registry.register(makeAdapter(credentialed));
    const result = await registry.resolve<EchoPort>("paid-category", {
      firmId: "firm_1",
      userId: "user_1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.descriptor).toBe(snapshot);
  });

  it("forwards userId for a user-scoped port and omits it for a firm-scoped port", async () => {
    class SpyStore implements ConnectionStore {
      readonly lookups: ConnectionLookup[] = [];
      async getConnection(lookup: ConnectionLookup): Promise<IntegrationConnection | null> {
        this.lookups.push(lookup);
        return null;
      }
    }
    const credentialStore = new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" });

    const userSpy = new SpyStore();
    const userRegistry = createIntegrationRegistry({ connectionStore: userSpy, credentialStore });
    userRegistry.register(makeAdapter(credentialed));
    await userRegistry.resolve<EchoPort>("paid-category", { firmId: "firm_1", userId: "user_1" });
    expect(userSpy.lookups[0]?.userId).toBe("user_1");

    const firmScoped: CapabilityDescriptor = {
      ...credentialed,
      adapterId: "firm-paid",
      category: "firm-category",
      credential: { kind: "oauth", scope: "firm" },
    };
    const firmSpy = new SpyStore();
    const firmRegistry = createIntegrationRegistry({ connectionStore: firmSpy, credentialStore });
    firmRegistry.register(makeAdapter(firmScoped));
    await firmRegistry.resolve<EchoPort>("firm-category", { firmId: "firm_1", userId: "user_1" });
    expect(firmSpy.lookups[0]?.userId).toBeUndefined();
  });
});

describe("requireCapability", () => {
  it("passes a supported operation (returning the same resolved) and rejects an unsupported one", () => {
    const resolved = { port: { echo: () => "x" }, descriptor: credentialLess };
    const passed = requireCapability(resolved, "echo");
    expect(passed.ok).toBe(true);
    if (passed.ok) expect(passed.value).toBe(resolved);
    expect(requireCapability(resolved, "missing")).toEqual({
      ok: false,
      reason: "capability-unsupported",
    });
  });
});
