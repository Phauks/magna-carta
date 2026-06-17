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
  it("round-trips an oauth credential through the secret store", async () => {
    const store = createFirmSecretCredentialStore(memorySecretStore());
    const credential = { kind: "oauth" as const, refreshToken: "refresh_xyz" };
    await store.put("cred_ref_1", credential);
    const loaded = await store.get("cred_ref_1");
    expect(loaded).toEqual(credential);
  });

  it("returns null for an unknown ref", async () => {
    const store = createFirmSecretCredentialStore(memorySecretStore());
    expect(await store.get("missing")).toBeNull();
  });
});
