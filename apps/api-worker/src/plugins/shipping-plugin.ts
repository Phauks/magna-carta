import { shippingManifest } from "@magna-carta/shipping/manifest";
import { createEasyPostAdapter } from "@magna-carta/shipping/easypost";
import { registerShippingRoutes } from "../http/routes/communications/shipping.ts";
import type { WorkerPlugin } from "./registry.ts";

export const shippingPlugin: WorkerPlugin = {
  manifest: shippingManifest,
  registerRoutes: (app, chokepoint, runtime) => registerShippingRoutes(app, chokepoint, runtime),
  registerAdapter: (registry, runtime) =>
    registry.register(createEasyPostAdapter({ http: runtime.httpClient })),
};
