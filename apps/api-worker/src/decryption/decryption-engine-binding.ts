import type { Bindings } from "../app.ts";
import { containerDecryptionAdapter } from "./container-decryption-adapter.ts";
import { engineUnavailablePort, type DecryptionEnginePort } from "./decryption-engine-port.ts";

// Resolve the active decryption engine. The engine lives in the standalone recovery worker
// (magna-carta-recovery), which owns the Container that runs the decryption-core crate; it is
// reached over the RECOVERY_SERVICE binding and selected here when the binding is present. Absent
// before that worker is deployed, where the no-engine port runs (an honest "no engine in this
// deployment", never a fabricated hash and never a refusal blamed on the file).
//
// The same binding carries the long-running recovery search (recovery/recovery-backend.ts). These
// header reads are the other traffic on it and are nothing like it: one short synchronous call per
// request, on the member's own connection, with no job, no queue, and no coordinator.
export function resolveDecryptionEnginePort(env: Bindings): DecryptionEnginePort {
  return env.RECOVERY_SERVICE !== undefined
    ? containerDecryptionAdapter(env.RECOVERY_SERVICE)
    : engineUnavailablePort;
}
