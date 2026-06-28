import { type Dispatch, notConnected } from "@magna-carta/integrations/dispatch";
import type { Adapter, AdapterContext } from "@magna-carta/integrations/port";
import type { DetectionReport } from "../report.ts";
import type { AiTextDetectionPort } from "../port.ts";
import { deferredCapability } from "../manifest.ts";

// The one runnable adapter shipped now. A concrete vendor adapter drops in beside this with no change
// to the port: it implements detect() by calling the vendor over an injected HttpClient and running
// the raw result through normalize().
export const deferredAiDetectionAdapter: Adapter<AiTextDetectionPort> = {
  descriptor: deferredCapability,
  create(_context: AdapterContext): AiTextDetectionPort {
    return {
      async detect(): Promise<Dispatch<DetectionReport>> {
        return notConnected();
      },
    };
  },
};
