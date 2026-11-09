import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import type { FirmId } from "@magna-carta/identifiers/types";
import { describe, expect, it, vi } from "vitest";
import {
  createFirmKeyProvider,
  FirmKeyUnavailableError,
  type WrappedKeyRow,
} from "../src/firm-key-provider.ts";

// A fixed 32-byte base64 root KEK for the tests (mirrors the .dev.vars placeholder shape).
const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";

async function wrappedKeyFor(): Promise<string> {
  const rootKek = await importRootKek(ROOT_KEK);
  return wrapFirmKey(rootKek, generateFirmKeyBytes());
}

describe("createFirmKeyProvider", () => {
  it("caches the unwrapped key — readWrappedKey runs once across two gets", async () => {
    const wrapped = await wrappedKeyFor();
    const readWrappedKey = vi.fn(async (): Promise<WrappedKeyRow> => ({
      wrappedFirmKey: wrapped,
      firmKeyVersion: 1,
    }));
    const provider = createFirmKeyProvider({ rootKekBase64: ROOT_KEK, readWrappedKey });

    const first = await provider.getFirmHkdfKey("firm_a" as FirmId);
    const second = await provider.getFirmHkdfKey("firm_a" as FirmId);

    expect(readWrappedKey).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.extractable).toBe(false);
  });

  it("evicts the oldest entry at capacity (insertion-order)", async () => {
    const wrappedByFirm = new Map<string, string>([
      ["firm_1", await wrappedKeyFor()],
      ["firm_2", await wrappedKeyFor()],
      ["firm_3", await wrappedKeyFor()],
    ]);
    const readWrappedKey = vi.fn(async (firmId: FirmId): Promise<WrappedKeyRow> => ({
      wrappedFirmKey: wrappedByFirm.get(firmId) ?? null,
      firmKeyVersion: 1,
    }));
    const provider = createFirmKeyProvider({
      rootKekBase64: ROOT_KEK,
      readWrappedKey,
      cacheCapacity: 2,
    });

    await provider.getFirmHkdfKey("firm_1" as FirmId);
    await provider.getFirmHkdfKey("firm_2" as FirmId); // cache now {firm_1, firm_2}
    await provider.getFirmHkdfKey("firm_3" as FirmId); // evicts firm_1 → {firm_2, firm_3}
    expect(readWrappedKey).toHaveBeenCalledTimes(3);

    await provider.getFirmHkdfKey("firm_1" as FirmId); // re-read (was evicted)
    expect(readWrappedKey).toHaveBeenCalledTimes(4);
    await provider.getFirmHkdfKey("firm_3" as FirmId); // still cached — no re-read
    expect(readWrappedKey).toHaveBeenCalledTimes(4);
  });

  it("fails closed on a null wrapped key and does NOT cache the failure", async () => {
    const wrapped = await wrappedKeyFor();
    let row: WrappedKeyRow = { wrappedFirmKey: null, firmKeyVersion: 1 };
    const readWrappedKey = vi.fn(async (): Promise<WrappedKeyRow | null> => row);
    const provider = createFirmKeyProvider({ rootKekBase64: ROOT_KEK, readWrappedKey });

    await expect(provider.getFirmHkdfKey("firm_a" as FirmId)).rejects.toBeInstanceOf(
      FirmKeyUnavailableError,
    );
    // A subsequent mint is visible — the null was not cached.
    row = { wrappedFirmKey: wrapped, firmKeyVersion: 1 };
    const key = await provider.getFirmHkdfKey("firm_a" as FirmId);
    expect(key.extractable).toBe(false);
    expect(readWrappedKey).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the firm row is absent (null)", async () => {
    const provider = createFirmKeyProvider({
      rootKekBase64: ROOT_KEK,
      readWrappedKey: async (): Promise<WrappedKeyRow | null> => null,
    });
    await expect(provider.getFirmHkdfKey("firm_x" as FirmId)).rejects.toBeInstanceOf(
      FirmKeyUnavailableError,
    );
  });

  it("invalidate forces a re-read (the shred same-isolate window)", async () => {
    const wrapped = await wrappedKeyFor();
    const readWrappedKey = vi.fn(async (): Promise<WrappedKeyRow> => ({
      wrappedFirmKey: wrapped,
      firmKeyVersion: 1,
    }));
    const provider = createFirmKeyProvider({ rootKekBase64: ROOT_KEK, readWrappedKey });

    await provider.getFirmHkdfKey("firm_a" as FirmId);
    expect(readWrappedKey).toHaveBeenCalledTimes(1);
    provider.invalidate("firm_a" as FirmId);
    await provider.getFirmHkdfKey("firm_a" as FirmId);
    expect(readWrappedKey).toHaveBeenCalledTimes(2);
  });
});
