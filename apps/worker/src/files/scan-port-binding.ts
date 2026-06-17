import { unscannedAdapter, type MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../app.ts";

// Resolve the active scan engine. Until the scan Container lands, every firm runs the engine-less
// adapter (honest `unscanned`/no-engine). The Container adapter is selected here when its binding is
// present, so the swap is one file and no consumer change.
export function resolveScanPort(_env: Bindings): MalwareScanPort {
  return unscannedAdapter;
}
