import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Non-state US jurisdictions that have an online property search. DC (a federal district), Guam, and
// the US Virgin Islands each have a searchable portal — the USVI portal covers all three island
// districts. CNMI and American Samoa have no online parcel system at all, so they are deliberately
// not encoded: every encoded jurisdiction must be searchable.

export const DISTRICT_OF_COLUMBIA_SITES: readonly AssessorSite[] = [
  stateSites("DC").search(
    "11001",
    "District of Columbia",
    "https://mytax.dc.gov/_/?Link=PropertySearch",
  ),
];

export const GUAM_SITES: readonly AssessorSite[] = [
  stateSites("GU").search("66010", "Guam", "https://www.guamtax.com/realPropertyTaxInquiry.do"),
];

const vi = stateSites("VI");
const VI_PORTAL = "https://propertytax.vi.gov/";

export const US_VIRGIN_ISLANDS_SITES: readonly AssessorSite[] = [
  vi.search("78010", "St. Croix", VI_PORTAL),
  vi.search("78020", "St. John", VI_PORTAL),
  vi.search("78030", "St. Thomas", VI_PORTAL),
];
