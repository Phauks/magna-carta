import { unscannedAdapter, type MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../bindings.ts";
import { containerScanAdapter } from "./container-scan-adapter.ts";

// Resolve the active scan engine. The engine lives in the standalone scan-worker (magna-carta-scan),
// reached over the SCAN_SERVICE binding; selected here when the binding is present. Absent in every
// test environment (a service binding to an unavailable service will not boot the pool, so tests bind
// a no-engine stub) and before the scan worker is deployed, where the engine-less adapter runs (an
// honest `unscanned`/no-engine, never a false `clean`).
export function resolveScanPort(env: Bindings): MalwareScanPort {
  if (env.SCAN_SERVICE !== undefined) {
    return containerScanAdapter(env.SCAN_SERVICE);
  }
  return unscannedAdapter;
}
