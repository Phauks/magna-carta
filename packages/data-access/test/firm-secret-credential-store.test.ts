import { describe, expect, it } from "vitest";
import {
  createFirmSecretCredentialStore,
  type SecretStore,
} from "../src/firm-secret-credential-store.ts";

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    getSecret: async (ref) => map.get(ref) ?? null,
    putSecret: async (ref, value) => void map.set(ref, value),
  };
}

describe("firm_secret-backed CredentialStore", () => {
  it("round-trips an api-key credential through the secret store", async () => {
    const store = createFirmSecretCredentialStore(memorySecretStore());
    await store.put("cred_ref_1", { kind: "apiKey", apiKey: "ezk_live_xyz" });
    const loaded = await store.get("cred_ref_1");
    expect(loaded).toEqual({ kind: "apiKey", apiKey: "ezk_live_xyz" });
  });

  it("returns null for an unknown ref", async () => {
    const store = createFirmSecretCredentialStore(memorySecretStore());
    expect(await store.get("missing")).toBeNull();
  });
});
