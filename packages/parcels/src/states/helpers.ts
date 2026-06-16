import type {
  AssessorPlatform,
  AssessorSite,
  JurisdictionType,
  ParcelKeyFormat,
} from "../types.ts";

// NETROnline's Public Records Online Directory has a stable page per US county listing that county's
// official assessor / property-search links — a uniform, complete searchable fallback for any county
// with no verified direct portal (so every county is searchable). Slug rule: lowercase, drop periods
// and apostrophes, spaces -> underscores ("St. Mary's" -> "st_marys"). Independent cities and
// city/county collisions need an explicit slug, so an override is accepted.
export function netronline(state: string, county: string, slug?: string): string {
  const resolved = slug ?? county.toLowerCase().replace(/['.]/g, "").replace(/\s+/g, "_");
  return `https://publicrecords.netronline.com/state/${state}/county/${resolved}`;
}

// Site builders bound to one state (and one jurisdiction type), so a state module names the state
// once and every row is a one-liner. `search` = no deep-link (open the search page); `template` = a
// bespoke `{apn}` URL; `platform` = a shared adapter (platforms.ts) with the per-jurisdiction host
// and any params / key format. This is the one way to author a state module. Pass `"municipality"`
// for the town-assessed New England states — their `jurisdictionId` is the 10-digit county-subdivision
// (MCD) GEOID rather than a 5-digit county FIPS.
export function stateSites(state: string, jurisdictionType: JurisdictionType = "county") {
  return {
    search: (jurisdictionId: string, name: string, searchUrl: string): AssessorSite => ({
      jurisdictionId,
      jurisdictionType,
      state,
      name,
      searchUrl,
      deepLink: { kind: "searchPage" },
    }),
    template: (
      jurisdictionId: string,
      name: string,
      searchUrl: string,
      template: string,
      keyFormat?: ParcelKeyFormat,
    ): AssessorSite => ({
      jurisdictionId,
      jurisdictionType,
      state,
      name,
      searchUrl,
      deepLink: keyFormat
        ? { kind: "template", template, keyFormat }
        : { kind: "template", template },
    }),
    platform: (
      jurisdictionId: string,
      name: string,
      searchUrl: string,
      platform: AssessorPlatform,
      host: string,
      opts?: { params?: Readonly<Record<string, string>>; keyFormat?: ParcelKeyFormat },
    ): AssessorSite => ({
      jurisdictionId,
      jurisdictionType,
      state,
      name,
      searchUrl,
      deepLink: {
        kind: "platform",
        platform,
        host,
        params: opts?.params,
        keyFormat: opts?.keyFormat,
      },
    }),
  };
}
