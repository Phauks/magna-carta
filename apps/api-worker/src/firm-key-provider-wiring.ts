import {
  createFirmKeyProvider,
  type FirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "./bindings.ts";

// One firm-key provider per worker env — the same per-isolate caching discipline as authForEnv: the
// env object is stable within an isolate, so the unwrapped non-extractable HKDF handles are cached
// across requests (safe precisely because the handles cannot be exported). The wrapped key is read
// from the control-plane firm row on a cache miss; a null wrapped key (unminted or shredded) fails
// closed. The crypto-shred path invalidates this same provider so a just-nulled key cannot keep
// being served from the cache in the same isolate.
const providerByEnv = new WeakMap<Bindings, FirmKeyProvider>();

export function firmKeyProviderForEnv(env: Bindings): FirmKeyProvider {
  let provider = providerByEnv.get(env);
  if (provider === undefined) {
    provider = createFirmKeyProvider({
      rootKekBase64: env.ROOT_KEK,
      readWrappedKey: (firmId: FirmId): Promise<WrappedKeyRow | null> =>
        env.DB_CONTROL.prepare("SELECT wrapped_firm_key, firm_key_version FROM firm WHERE id = ?1")
          .bind(firmId)
          .first<{ wrapped_firm_key: string | null; firm_key_version: number }>()
          .then((row) =>
            row === null
              ? null
              : { wrappedFirmKey: row.wrapped_firm_key, firmKeyVersion: row.firm_key_version },
          ),
    });
    providerByEnv.set(env, provider);
  }
  return provider;
}
