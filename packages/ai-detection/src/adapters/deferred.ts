import { capabilityUnsupported, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { Adapter, AdapterContext } from "@magna-carta/integrations/port";
import type { DetectionReport } from "../report.ts";
import type { AiTextDetectionPort } from "../port.ts";
import { deferredCapability } from "../manifest.ts";

// The one runnable adapter shipped now. A concrete vendor adapter drops in beside this with no change
// to the port: it implements detect() by calling the vendor over an injected HttpClient and running
// the raw result through normalize().
//
// The descriptor declares detect.supported = false, so the honest signal for "no vendor wired" is
// `capability-unsupported`, not `not-connected` — a credential-less adapter has no connection to be
// missing; the capability simply hasn't been wired to a concrete vendor yet.
export const deferredAiDetectionAdapter: Adapter<AiTextDetectionPort> = {
  descriptor: deferredCapability,
  create(_context: AdapterContext): AiTextDetectionPort {
    return {
      async detect(): Promise<Dispatch<DetectionReport>> {
        return capabilityUnsupported();
      },
    };
  },
};
