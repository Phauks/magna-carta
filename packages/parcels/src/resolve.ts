import { normalizeKey } from "./apn.ts";
import { ASSESSOR_PLATFORMS } from "./platforms.ts";
import type { AssessorLookup, PortalLookup, PortalSite } from "./types.ts";

// Build the best URL to view a record on a government portal. "Best" is the most specific link the
// portal supports for what the caller knows: a deep-link when a public key is in hand (plus the tax
// year where a property platform requires it), otherwise the search page — which always works. The
// key is normalized per the portal's format before substitution. Never throws, never returns an
// empty or broken URL, so a consumer can always hand the user a usable link.
export function portalUrl(site: PortalSite, lookup: PortalLookup = {}): string {
  const key = lookup.key?.trim();
  const { deepLink } = site;

  if (key) {
    if (deepLink.kind === "platform") {
      const adapter = ASSESSOR_PLATFORMS[deepLink.platform];
      if (!adapter.requiresYear || lookup.year !== undefined) {
        const normalized = encodeURIComponent(
          normalizeKey(key, deepLink.keyFormat ?? adapter.defaultKeyFormat),
        );
        return adapter.build({
          host: deepLink.host,
          params: deepLink.params,
          key: normalized,
          year: lookup.year,
        });
      }
    } else if (deepLink.kind === "template") {
      const normalized = encodeURIComponent(
        normalizeKey(key, deepLink.keyFormat ?? "stripSeparators"),
      );
      return deepLink.template.replace("{apn}", normalized);
    }
  }
  return site.searchUrl;
}

// Property spelling: an APN (and the tax year some platforms require) in, the assessor URL out.
export function assessorUrl(site: PortalSite, lookup: AssessorLookup = {}): string {
  return portalUrl(site, { key: lookup.apn, year: lookup.year });
}
