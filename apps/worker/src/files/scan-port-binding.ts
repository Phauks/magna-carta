import { getContainer } from "@cloudflare/containers";
import { unscannedAdapter, type MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../app.ts";
import { containerScanAdapter } from "./container-scan-adapter.ts";

// Resolve the active scan engine. The real engine is the scan Container; it is selected here when its
// binding is present, so turning the engine on in production is one deploy-time step (add the wrangler
// `containers`/DO/migration block + build the image) with no consumer change. Until then — and in every
// test environment, where the container cannot run under the local pool — the binding is absent and the
// engine-less adapter runs (an honest `unscanned`/no-engine, never a false `clean`).
export function resolveScanPort(env: Bindings): MalwareScanPort {
  if (env.SCAN_CONTAINER !== undefined) {
    return containerScanAdapter(getContainer(env.SCAN_CONTAINER, "scan"));
  }
  return unscannedAdapter;
}
