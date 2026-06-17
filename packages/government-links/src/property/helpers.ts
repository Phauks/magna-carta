import type {
  AssessorPlatform,
  AssessorSite,
  JurisdictionType,
  ParcelKeyFormat,
  PortalSystem,
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

// Site builders bound to one state, one property system (assessor / recorder / gis), and one
// jurisdiction type, so a state module names them once and every row is a one-liner. `search` = no
// deep-link (open the search page); `template` = a bespoke `{apn}` URL; `platform` = a shared adapter
// (platforms.ts) with the per-jurisdiction host and any params / key format. Pass `"municipality"` for
// the town-assessed New England states — their `jurisdictionId` is the 10-digit county-subdivision
// (MCD) GEOID rather than a 5-digit county FIPS.
function propertyBuilders(state: string, system: PortalSystem, jurisdictionType: JurisdictionType) {
  return {
    search: (jurisdictionId: string, name: string, searchUrl: string): AssessorSite => ({
      jurisdictionId,
      jurisdictionType,
      category: "property",
      system,
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
      category: "property",
      system,
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
      category: "property",
      system,
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

// One factory per property system. `stateSites` is the assessor builder (the one every existing state
// module uses); `recorderSites` / `gisSites` build the recorder (deeds/liens search) and GIS
// (parcel-map) portals for the same counties — the registry keys on system + jurisdiction, so a county
// can carry all three without collision.
export function stateSites(state: string, jurisdictionType: JurisdictionType = "county") {
  return propertyBuilders(state, "assessor", jurisdictionType);
}

export function recorderSites(state: string, jurisdictionType: JurisdictionType = "county") {
  return propertyBuilders(state, "recorder", jurisdictionType);
}

export function gisSites(state: string, jurisdictionType: JurisdictionType = "county") {
  return propertyBuilders(state, "gis", jurisdictionType);
}
