import { describe, expect, it } from "vitest";
import type { Credential, CredentialStore } from "../src/credentials.ts";
import type { CredentialRequirement } from "../src/port.ts";

class InMemoryCredentialStore implements CredentialStore {
  readonly #map = new Map<string, Credential>();
  async get(ref: string): Promise<Credential | null> {
    return this.#map.get(ref) ?? null;
  }
  async put(ref: string, credential: Credential): Promise<void> {
    this.#map.set(ref, credential);
  }
}

describe("CredentialStore contract", () => {
  it("round-trips an oauth credential and returns null when absent", async () => {
    const store = new InMemoryCredentialStore();
    await store.put("ref-1", { kind: "oauth", refreshToken: "r1" });
    expect(await store.get("ref-1")).toEqual({ kind: "oauth", refreshToken: "r1" });
    expect(await store.get("missing")).toBeNull();
  });
});

describe("api-key credential kind", () => {
  it("admits an apiKey credential into the Credential union", () => {
    const credential: Credential = { kind: "apiKey", apiKey: "ezk_test_123" };
    expect(credential.kind).toBe("apiKey");
  });

  it("admits an apiKey requirement carrying a scope", () => {
    const requirement: CredentialRequirement = { kind: "apiKey", scope: "firm" };
    expect(requirement).toEqual({ kind: "apiKey", scope: "firm" });
  });
});
