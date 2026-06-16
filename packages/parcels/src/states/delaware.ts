import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Delaware's 3 county property-assessment systems. Each county runs its own (no statewide search,
// despite the 2023-2024 Tyler reassessment of values): Kent on the custom "PRIDE" app, New Castle
// on a custom ASP.NET app, Sussex on Tyler iasWorld. None exposes a verified parcel deep-link today
// (Sussex's iasWorld `parid` parameter is plausible but unconfirmed), so all open the search page.
const { search } = stateSites("DE");

export const DELAWARE_ASSESSOR_SITES: readonly AssessorSite[] = [
  search("10001", "Kent", "https://pride.kentcountyde.gov/propertysearch/propertyinfopanel/"),
  search("10003", "New Castle", "https://www3.newcastlede.gov/parcel/search/"),
  search(
    "10005",
    "Sussex",
    "https://property.sussexcountyde.gov/PT/search/commonsearch.aspx?mode=parid",
  ),
];
