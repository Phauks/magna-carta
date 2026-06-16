import { normalizeKey } from "./apn.ts";
import { ASSESSOR_PLATFORMS } from "./platforms.ts";
import type { AssessorLookup, AssessorSite } from "./types.ts";

// Build the best URL to view a property on its assessor site. "Best" is the most specific link the
// jurisdiction supports for what the caller knows: a parcel deep-link when an APN is in hand (plus
// the tax year where the platform requires it), otherwise the search page — which always works. The
// parcel key is normalized per the jurisdiction's format before substitution. Never throws, never
// returns an empty or broken URL, so a consumer can always hand the user a usable link.
export function assessorUrl(site: AssessorSite, lookup: AssessorLookup = {}): string {
  const apn = lookup.apn?.trim();
  const { deepLink } = site;

  if (apn) {
    if (deepLink.kind === "platform") {
      const adapter = ASSESSOR_PLATFORMS[deepLink.platform];
      if (!adapter.requiresYear || lookup.year !== undefined) {
        const key = encodeURIComponent(
          normalizeKey(apn, deepLink.keyFormat ?? adapter.defaultKeyFormat),
        );
        return adapter.build({
          host: deepLink.host,
          params: deepLink.params,
          key,
          year: lookup.year,
        });
      }
    } else if (deepLink.kind === "template") {
      const key = encodeURIComponent(normalizeKey(apn, deepLink.keyFormat ?? "stripSeparators"));
      return deepLink.template.replace("{apn}", key);
    }
  }
  return site.searchUrl;
}
