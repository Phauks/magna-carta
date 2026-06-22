import { fetchHttpClient } from "@magna-carta/integrations/http";
import type { IntegrationManifest } from "@magna-carta/integrations/manifest";
import { z } from "zod";
import { createEasyPostAdapter } from "./easypost/adapter.ts";

// EasyPost is the firm's postage account: one apiKey credential per firm. The capability descriptor
// is the adapter's own (built with a throwaway client — descriptor construction makes no network
// call). connectSchema/settingsSchema are consumed by the marketplace slice.
export const shippingManifest: IntegrationManifest = {
  id: "easypost",
  category: "shipping",
  displayName: "EasyPost",
  summary: "Buy USPS/UPS/FedEx postage and certified mail, print labels, and track shipments.",
  vendorUrl: "https://www.easypost.com",
  credential: { kind: "apiKey", scope: "firm" },
  capability: createEasyPostAdapter({ http: fetchHttpClient() }).descriptor,
  permission: "shipping:manage",
  defaultEnablement: "off",
  connectSchema: z.object({ apiKey: z.string().min(1) }),
  settingsSchema: z.object({
    defaultLabelFormat: z.enum(["PDF", "ZPL", "PNG"]).optional(),
  }),
};
