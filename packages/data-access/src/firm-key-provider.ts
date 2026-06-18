import { importRootKek, unwrapFirmKeyToHkdfKey } from "@magna-carta/encryption/keys";
import type { FirmId } from "@magna-carta/identifiers/types";

// The firm-key provider: turns a firm's wrapped data key (read from the control plane) into a
// cached, non-extractable HKDF base key the protected-field chokepoint derives purpose/index keys
// from. The root KEK is imported once; per-firm keys are unwrapped on demand and cached. A null
// wrapped key (unminted, or shredded) fails closed and is NOT cached, so a later mint is seen.

// Thrown when a firm has no usable data key — never minted yet, or crypto-shredded. Fail-closed:
// every protected read/write for that firm refuses rather than silently proceeding.
export class FirmKeyUnavailableError extends Error {
  readonly firmId: string;
  constructor(firmId: string) {
    super(`no firm data key available for ${firmId} (unminted or shredded)`);
    this.name = "FirmKeyUnavailableError";
    this.firmId = firmId;
  }
}

export interface WrappedKeyRow {
  readonly wrappedFirmKey: string | null;
  readonly firmKeyVersion: number;
}

export interface FirmKeyProvider {
  // The firm's non-extractable HKDF base key; throws FirmKeyUnavailableError on a null wrapped key.
  getFirmHkdfKey(firmId: FirmId): Promise<CryptoKey>;
  // Drop a cached key — the shred path calls this so the same-isolate cache cannot serve a key
  // whose wrapped form was just nulled.
  invalidate(firmId: FirmId): void;
}

const DEFAULT_CACHE_CAPACITY = 32;

export function createFirmKeyProvider(options: {
  readonly rootKekBase64: string;
  readonly readWrappedKey: (firmId: FirmId) => Promise<WrappedKeyRow | null>;
  readonly cacheCapacity?: number;
}): FirmKeyProvider {
  const capacity = options.cacheCapacity ?? DEFAULT_CACHE_CAPACITY;
  // Resolved non-extractable HKDF handles, keyed by firm id. Safe to cache because the handles are
  // non-extractable — the bytes never surface. Insertion-order eviction (a plain Map's first key is
  // its oldest) keeps the cache bounded without an LRU dependency.
  const cache = new Map<string, CryptoKey>();
  let rootKekPromise: Promise<CryptoKey> | undefined;
  const rootKek = (): Promise<CryptoKey> =>
    (rootKekPromise ??= importRootKek(options.rootKekBase64));

  return {
    async getFirmHkdfKey(firmId: FirmId): Promise<CryptoKey> {
      const cached = cache.get(firmId);
      if (cached !== undefined) return cached;
      const row = await options.readWrappedKey(firmId);
      if (row === null || row.wrappedFirmKey === null) {
        // Fail closed and do NOT cache the failure — a subsequent mint must be visible.
        throw new FirmKeyUnavailableError(firmId);
      }
      const key = await unwrapFirmKeyToHkdfKey(await rootKek(), row.wrappedFirmKey);
      if (cache.size >= capacity) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(firmId, key);
      return key;
    },
    invalidate(firmId: FirmId): void {
      cache.delete(firmId);
    },
  };
}
