import { describe, expect, it } from "vitest";
import type { Credential, CredentialStore } from "../src/credentials.ts";

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
