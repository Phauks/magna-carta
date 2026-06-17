import { ALASKA_ASSESSOR_SITES } from "./alaska.ts";
import { ARIZONA_ASSESSOR_SITES } from "./arizona.ts";
import { CALIFORNIA_ASSESSOR_SITES } from "./california.ts";
import { COLORADO_ASSESSOR_SITES } from "./colorado.ts";
import { DELAWARE_ASSESSOR_SITES } from "./delaware.ts";
import { HAWAII_ASSESSOR_SITES } from "./hawaii.ts";
import { IDAHO_ASSESSOR_SITES } from "./idaho.ts";
import { KANSAS_ASSESSOR_SITES } from "./kansas.ts";
import { MONTANA_ASSESSOR_SITES } from "./montana.ts";
import { NEBRASKA_ASSESSOR_SITES } from "./nebraska.ts";
import { NEVADA_ASSESSOR_SITES } from "./nevada.ts";
import { NEW_MEXICO_ASSESSOR_SITES } from "./newmexico.ts";
import { NORTH_DAKOTA_ASSESSOR_SITES } from "./northdakota.ts";
import { OKLAHOMA_ASSESSOR_SITES } from "./oklahoma.ts";
import { OREGON_ASSESSOR_SITES } from "./oregon.ts";
import { SOUTH_DAKOTA_ASSESSOR_SITES } from "./southdakota.ts";
import {
  DISTRICT_OF_COLUMBIA_SITES,
  GUAM_SITES,
  US_VIRGIN_ISLANDS_SITES,
} from "./us-territories.ts";
import { UTAH_ASSESSOR_SITES } from "./utah.ts";
import { WASHINGTON_ASSESSOR_SITES } from "./washington.ts";
import { WYOMING_ASSESSOR_SITES } from "./wyoming.ts";
import type { AssessorSite } from "../types.ts";

// One row registers a state's property (assessor) coverage: its 2-letter postal code, 2-digit state
// FIPS prefix, the expected jurisdiction count (a drop/duplicate guard the tests assert), and its
// sites. Adding a state is exactly this one row plus the `property/<state>.ts` module — the coverage
// and integrity tests derive from this table, so nothing else is edited per state.
export interface StateRegistration {
  readonly code: string;
  readonly fipsPrefix: string;
  readonly count: number;
  readonly sites: readonly AssessorSite[];
}

// Kept sorted by FIPS prefix — insert a new state in numeric order, not appended.
export const STATES: readonly StateRegistration[] = [
  { code: "AK", fipsPrefix: "02", count: 14, sites: ALASKA_ASSESSOR_SITES },
  { code: "AZ", fipsPrefix: "04", count: 15, sites: ARIZONA_ASSESSOR_SITES },
  { code: "CA", fipsPrefix: "06", count: 58, sites: CALIFORNIA_ASSESSOR_SITES },
  { code: "CO", fipsPrefix: "08", count: 64, sites: COLORADO_ASSESSOR_SITES },
  { code: "DE", fipsPrefix: "10", count: 3, sites: DELAWARE_ASSESSOR_SITES },
  { code: "DC", fipsPrefix: "11", count: 1, sites: DISTRICT_OF_COLUMBIA_SITES },
  { code: "HI", fipsPrefix: "15", count: 5, sites: HAWAII_ASSESSOR_SITES },
  { code: "ID", fipsPrefix: "16", count: 44, sites: IDAHO_ASSESSOR_SITES },
  { code: "KS", fipsPrefix: "20", count: 105, sites: KANSAS_ASSESSOR_SITES },
  { code: "MT", fipsPrefix: "30", count: 56, sites: MONTANA_ASSESSOR_SITES },
  { code: "NE", fipsPrefix: "31", count: 93, sites: NEBRASKA_ASSESSOR_SITES },
  { code: "NV", fipsPrefix: "32", count: 17, sites: NEVADA_ASSESSOR_SITES },
  { code: "NM", fipsPrefix: "35", count: 33, sites: NEW_MEXICO_ASSESSOR_SITES },
  { code: "ND", fipsPrefix: "38", count: 53, sites: NORTH_DAKOTA_ASSESSOR_SITES },
  { code: "OK", fipsPrefix: "40", count: 77, sites: OKLAHOMA_ASSESSOR_SITES },
  { code: "OR", fipsPrefix: "41", count: 36, sites: OREGON_ASSESSOR_SITES },
  { code: "SD", fipsPrefix: "46", count: 66, sites: SOUTH_DAKOTA_ASSESSOR_SITES },
  { code: "UT", fipsPrefix: "49", count: 29, sites: UTAH_ASSESSOR_SITES },
  { code: "WA", fipsPrefix: "53", count: 39, sites: WASHINGTON_ASSESSOR_SITES },
  { code: "WY", fipsPrefix: "56", count: 23, sites: WYOMING_ASSESSOR_SITES },
  { code: "GU", fipsPrefix: "66", count: 1, sites: GUAM_SITES },
  { code: "VI", fipsPrefix: "78", count: 3, sites: US_VIRGIN_ISLANDS_SITES },
];

const ASSESSOR_BY_JURISDICTION: ReadonlyMap<string, AssessorSite> = new Map(
  STATES.flatMap((state) => state.sites).map((site) => [site.jurisdictionId, site]),
);

// The assessor site for a county-equivalent (5-digit county FIPS / 10-digit MCD GEOID), or undefined
// where not yet covered (the consumer falls back to a plain web search).
export function assessorSiteForJurisdiction(jurisdictionId: string): AssessorSite | undefined {
  return ASSESSOR_BY_JURISDICTION.get(jurisdictionId);
}

export function allAssessorSites(): readonly AssessorSite[] {
  return STATES.flatMap((state) => state.sites);
}
