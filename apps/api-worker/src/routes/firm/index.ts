import { authForEnv } from "../../auth-instance.ts";
import { type Chokepoint } from "../../chokepoint/chokepoint.ts";
import { type AppRouter, createDomainApp, type DomainDeps } from "../domain-app.ts";
import { registerAutoFilePolicyRoutes } from "./auto-file-policy.ts";
import { registerCustomFieldsRoutes } from "./custom-fields.ts";
import { registerDocumentTypesRoutes } from "./document-types.ts";
import { registerDownloadPreferenceRoutes } from "./download-preferences.ts";
import { registerEditingPolicyRoutes } from "./editing-policy.ts";
import { registerFirmAiSettingsRoutes } from "./firm-ai-settings.ts";
import { registerFirmNotificationPolicyRoutes } from "./firm-notification-policy.ts";
import { registerFirmProfileRoutes } from "./firm-profile.ts";
import { registerFirmReportPolicyRoutes } from "./firm-report-policy.ts";
import { registerFirmTimePolicyRoutes } from "./firm-time-policy.ts";
import { registerFirmUsageRoute } from "./firm-usage.ts";
import { registerMatterTypesRoutes } from "./matter-types.ts";
import { registerNumberingRoutes } from "./numbering.ts";
import { registerReleaseChannelRoute } from "./release-channel.ts";
import { registerScanPolicyRoutes } from "./scan-policy.ts";

// The firm's settings tier: profile, the per-domain policies, numbering, custom fields, the classification types, and the beta release-channel door.
//
// One sub-app per domain, built by the one constructor and mounted at the root by the manifest
// (src/routes/manifest.ts). Every route below registers exactly as it did on the root app — through
// defineOpenAPIRoute and chokepointMiddleware — and the order inside this function is the order Hono
// matches in, so a literal path stays ahead of the pattern that would otherwise claim it.
export function mountFirm(app: AppRouter, chokepoint: Chokepoint, _deps: DomainDeps = {}): void {
  const domain = createDomainApp();
  registerFirmUsageRoute(domain, chokepoint);
  registerDownloadPreferenceRoutes(domain, chokepoint);
  // The firm ceiling on unattended filing, in the same administrative lane as the catch-all address.
  registerAutoFilePolicyRoutes(domain, chokepoint);
  registerReleaseChannelRoute(domain, chokepoint, authForEnv);
  registerMatterTypesRoutes(domain, chokepoint);
  registerDocumentTypesRoutes(domain, chokepoint);
  registerNumberingRoutes(domain, chokepoint);
  // Read and update the firm's malware scan-policy settings (tier, score floor, flagged treatment).
  registerScanPolicyRoutes(domain, chokepoint);
  registerEditingPolicyRoutes(domain, chokepoint);
  // Slice 1·4: firm-defined custom fields (definitions, picklist options, temporal values, the
  // non-destructive Convert, and the compliance purge seam) — composed through the same chokepoint.
  registerCustomFieldsRoutes(domain, chokepoint);
  // The FIRM's tier of the same policy — the in-app floor no member may lower, the retention window,
  // and the local hour the summary email lands. A firm-administration act, so it carries its own
  // permission rather than the member key beside it.
  registerFirmNotificationPolicyRoutes(domain, chokepoint);
  registerFirmProfileRoutes(domain, chokepoint);
  registerFirmReportPolicyRoutes(domain, chokepoint);
  registerFirmTimePolicyRoutes(domain, chokepoint);
  // The firm's AI settings: the two consent gates read by apps/api-worker/src/magnus/consent.ts,
  // plus the assistant's daily ceiling and the stated facts about the model in force. The only
  // writer of those gates — until this landed, a firm could not open either one.
  registerFirmAiSettingsRoutes(domain, chokepoint);
  app.route("/", domain);
}
