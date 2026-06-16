import type { AssessorSite } from "../types.ts";
import { businessSites } from "./helpers.ts";

// Nevada Secretary of State (state FIPS 32). Two state-level public-record portals: the business
// entity register (SilverFlume) and the UCC index. Both are search-only — neither deep-links by
// entity name. Nevada is retiring SilverFlume through late 2026 onto the ORION platform; the UCC
// index has already moved (projectorion.nv.gov) and the entity search is expected to follow, at
// which point the entity-search URL gets repointed.
const nevada = businessSites("32", "NV");

export const NEVADA_BUSINESS_SITES: readonly AssessorSite[] = [
  nevada.entitySearch(
    "Nevada Secretary of State — Business Entity Search",
    "https://esos.nv.gov/EntitySearch/OnlineEntitySearch",
  ),
  nevada.uccSearch("Nevada Secretary of State — UCC Search", "https://projectorion.nv.gov/"),
];
