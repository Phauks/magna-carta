import { describe, expect, it, vi } from "vitest";
import {
  resolveStoredSecrets,
  SECRETS_STORE_BINDING_PREFIX,
  secretSourcesOf,
} from "../src/stored-secrets.ts";

function storeBinding(value: string | Error) {
  return {
    get: vi.fn(async () => {
      if (value instanceof Error) throw value;
      return value;
    }),
  };
}

const NAMES = ["FIRST_SECRET", "SECOND_SECRET", "THIRD_SECRET"] as const;

describe("resolveStoredSecrets", () => {
  it("returns the same environment when no secret is bound from the store", async () => {
    const environment = { FIRST_SECRET: "worker-value", UNRELATED: 1 };
    const resolved = await resolveStoredSecrets(environment, NAMES);
    expect(resolved).toBe(environment);
    expect(secretSourcesOf(resolved, NAMES)).toEqual({
      FIRST_SECRET: "worker",
      SECOND_SECRET: "absent",
      THIRD_SECRET: "absent",
    });
  });

  it("prefers the prefixed store binding over the per-Worker secret", async () => {
    const environment = {
      FIRST_SECRET: "worker-value",
      [`${SECRETS_STORE_BINDING_PREFIX}FIRST_SECRET`]: storeBinding("store-value"),
      SECOND_SECRET: "second-worker-value",
    };
    const resolved = await resolveStoredSecrets(environment, NAMES);
    expect(resolved).not.toBe(environment);
    expect(resolved.FIRST_SECRET).toBe("store-value");
    expect(resolved.SECOND_SECRET).toBe("second-worker-value");
    expect(secretSourcesOf(resolved, NAMES)).toEqual({
      FIRST_SECRET: "secrets-store",
      SECOND_SECRET: "worker",
      THIRD_SECRET: "absent",
    });
  });

  it("reads a store binding bound under the secret's own name", async () => {
    const environment = { FIRST_SECRET: storeBinding("store-value") };
    const resolved = await resolveStoredSecrets(environment, NAMES);
    expect(resolved.FIRST_SECRET).toBe("store-value");
    expect(secretSourcesOf(resolved, NAMES).FIRST_SECRET).toBe("secrets-store");
  });

  it("falls back to the per-Worker secret when the store cannot answer", async () => {
    const environment = {
      FIRST_SECRET: "worker-value",
      [`${SECRETS_STORE_BINDING_PREFIX}FIRST_SECRET`]: storeBinding(new Error("not found")),
    };
    const resolved = await resolveStoredSecrets(environment, NAMES);
    expect(resolved.FIRST_SECRET).toBe("worker-value");
    expect(secretSourcesOf(resolved, NAMES).FIRST_SECRET).toBe("worker");
  });

  it("never hands a reader the binding object when the store cannot answer", async () => {
    const environment = { FIRST_SECRET: storeBinding(new Error("not found")) };
    const resolved = await resolveStoredSecrets(environment, NAMES);
    expect(resolved.FIRST_SECRET).toBeUndefined();
    expect(secretSourcesOf(resolved, NAMES).FIRST_SECRET).toBe("absent");
  });

  it("treats an empty store value as absent", async () => {
    const environment = {
      FIRST_SECRET: "worker-value",
      [`${SECRETS_STORE_BINDING_PREFIX}FIRST_SECRET`]: storeBinding(""),
    };
    const resolved = await resolveStoredSecrets(environment, NAMES);
    expect(resolved.FIRST_SECRET).toBe("worker-value");
  });

  it("reads each store binding once per isolate while the value is fresh", async () => {
    const binding = storeBinding("store-value");
    const environment = { [`${SECRETS_STORE_BINDING_PREFIX}FIRST_SECRET`]: binding };
    await resolveStoredSecrets(environment, NAMES);
    await resolveStoredSecrets(environment, NAMES);
    expect(binding.get).toHaveBeenCalledTimes(1);
  });

  it("leaves bindings that are not named secrets alone", async () => {
    const unrelated = { get: vi.fn() };
    const environment = {
      UNRELATED_BINDING: unrelated,
      [`${SECRETS_STORE_BINDING_PREFIX}FIRST_SECRET`]: storeBinding("store-value"),
    };
    const resolved = await resolveStoredSecrets(environment, NAMES);
    expect(resolved.UNRELATED_BINDING).toBe(unrelated);
    expect(unrelated.get).not.toHaveBeenCalled();
  });
});

describe("resolveStoredSecrets identity", () => {
  it("returns the same resolved object while the store values are unchanged", async () => {
    const environment = { [`${SECRETS_STORE_BINDING_PREFIX}FIRST_SECRET`]: storeBinding("value") };
    const first = await resolveStoredSecrets(environment, NAMES);
    const second = await resolveStoredSecrets(environment, NAMES);
    expect(second).toBe(first);
  });
});
