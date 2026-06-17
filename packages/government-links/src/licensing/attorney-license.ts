import type { AssessorSite } from "../types.ts";
import { licensingSites } from "./helpers.ts";

// Every US state's (and DC's) official attorney-license lookup — the public page where a lawyer's
// license status and standing are verified by name or bar number. Keyed by 2-digit state FIPS (bar
// admission is per state), so one row per state sits beside that state's business and property
// portals in the shared registry. The authority differs by state: a mandatory bar's member directory
// (most states), or — in non-unified-bar states — the judiciary / supreme court / disciplinary
// board's attorney-registration search (e.g. New York OCA, Ohio Supreme Court, Illinois ARDC, Kansas
// KARD, Arkansas AOC, Nebraska Judicial, Tennessee BPR). All search-only. New Hampshire and South
// Dakota publish no public instant name-search — verification there is by request form / phone through
// the NH Bar Association and the State Bar of South Dakota (the mandatory bars), so those two point at
// the official verification entry point rather than a search form.
interface AttorneyLicenseState {
  readonly fips: string;
  readonly code: string;
  readonly name: string;
  readonly lookup: string;
}

// Kept sorted by FIPS.
const ATTORNEY_LICENSE_STATES: readonly AttorneyLicenseState[] = [
  {
    fips: "01",
    code: "AL",
    name: "Alabama",
    lookup: "https://members.alabar.org/Member_Portal/Member_Portal/Member-Search.aspx",
  },
  {
    fips: "02",
    code: "AK",
    name: "Alaska",
    lookup: "https://alaskabar.org/for-lawyers/member-directories/",
  },
  {
    fips: "04",
    code: "AZ",
    name: "Arizona",
    lookup:
      "https://www.azbar.org/for-legal-professionals/practice-tools-management/member-directory/",
  },
  {
    fips: "05",
    code: "AR",
    name: "Arkansas",
    lookup: "https://attorneyinfo.aoc.arkansas.gov/info/attorney/attorneysearch.aspx",
  },
  {
    fips: "06",
    code: "CA",
    name: "California",
    lookup: "https://apps.calbar.ca.gov/attorney/LicenseeSearch/QuickSearch",
  },
  {
    fips: "08",
    code: "CO",
    name: "Colorado",
    lookup: "https://www.coloradolegalregulation.com/attorney-search/",
  },
  {
    fips: "09",
    code: "CT",
    name: "Connecticut",
    lookup: "https://www.jud.ct.gov/attorneyfirminquiry/AttorneyFirmInquiry.aspx",
  },
  {
    fips: "10",
    code: "DE",
    name: "Delaware",
    lookup: "https://www.dsba.org/resources/public-resources/",
  },
  {
    fips: "11",
    code: "DC",
    name: "District of Columbia",
    lookup: "https://my.dcbar.org/memberdirectory",
  },
  {
    fips: "12",
    code: "FL",
    name: "Florida",
    lookup: "https://www.floridabar.org/directories/find-mbr/",
  },
  { fips: "13", code: "GA", name: "Georgia", lookup: "https://www.gabar.org/member-directory/" },
  { fips: "15", code: "HI", name: "Hawaii", lookup: "https://hsba.org/member-directory" },
  {
    fips: "16",
    code: "ID",
    name: "Idaho",
    lookup: "https://isb.idaho.gov/licensing-mcle/attorney-roster-search/",
  },
  { fips: "17", code: "IL", name: "Illinois", lookup: "https://www.iardc.org/Lawyer/Search" },
  {
    fips: "18",
    code: "IN",
    name: "Indiana",
    lookup: "https://courtapps.in.gov/rollofattorneys/search",
  },
  {
    fips: "19",
    code: "IA",
    name: "Iowa",
    lookup: "https://www.iacourtcommissions.org/ords/f?p=106:10",
  },
  { fips: "20", code: "KS", name: "Kansas", lookup: "https://directory-kard.kscourts.gov/" },
  {
    fips: "21",
    code: "KY",
    name: "Kentucky",
    lookup: "https://kybar.org/For-Public/Find-a-Lawyer",
  },
  {
    fips: "22",
    code: "LA",
    name: "Louisiana",
    lookup: "https://www.lsba.org/MD321654/MembershipDirectory.aspx",
  },
  {
    fips: "23",
    code: "ME",
    name: "Maine",
    lookup: "https://www.mainebar.org/search/",
  },
  { fips: "24", code: "MD", name: "Maryland", lookup: "https://www.mdcourts.gov/attysearch" },
  {
    fips: "25",
    code: "MA",
    name: "Massachusetts",
    lookup: "https://www.massbbo.org/s/attorney-lookup",
  },
  { fips: "26", code: "MI", name: "Michigan", lookup: "https://directory.michbar.org/" },
  { fips: "27", code: "MN", name: "Minnesota", lookup: "https://mars.courts.state.mn.us/" },
  {
    fips: "28",
    code: "MS",
    name: "Mississippi",
    lookup: "https://courts.ms.gov/bar/barroll/barroll.php",
  },
  {
    fips: "29",
    code: "MO",
    name: "Missouri",
    lookup: "https://mobar.org/public/LawyerDirectory.aspx",
  },
  {
    fips: "30",
    code: "MT",
    name: "Montana",
    lookup: "https://www.montanabar.org/For-Attorneys/Attorney-Directory",
  },
  {
    fips: "31",
    code: "NE",
    name: "Nebraska",
    lookup: "https://attorneys.nejudicial.gov/member-search",
  },
  {
    fips: "32",
    code: "NV",
    name: "Nevada",
    lookup: "https://nvbar.org/find-a-lawyer/",
  },
  {
    fips: "33",
    code: "NH",
    name: "New Hampshire",
    lookup: "https://www.nhbar.org/attorney-verification-good-standing-request/",
  },
  {
    fips: "34",
    code: "NJ",
    name: "New Jersey",
    lookup: "https://drblookupportal.judiciary.state.nj.us/",
  },
  {
    fips: "35",
    code: "NM",
    name: "New Mexico",
    lookup: "https://www.sbnm.org/For-Public/I-Need-a-Lawyer/Online-Bar-Directory",
  },
  {
    fips: "36",
    code: "NY",
    name: "New York",
    lookup: "https://iapps.courts.state.ny.us/attorneyservices/search",
  },
  {
    fips: "37",
    code: "NC",
    name: "North Carolina",
    lookup: "https://portal.ncbar.gov/verification/search.aspx",
  },
  {
    fips: "38",
    code: "ND",
    name: "North Dakota",
    lookup: "https://www.ndcourts.gov/lawyers",
  },
  {
    fips: "39",
    code: "OH",
    name: "Ohio",
    lookup: "https://www.supremecourt.ohio.gov/AttorneySearch",
  },
  {
    fips: "40",
    code: "OK",
    name: "Oklahoma",
    lookup: "https://ams.okbar.org/eweb/startpage.aspx?site=FALWEB",
  },
  {
    fips: "41",
    code: "OR",
    name: "Oregon",
    lookup: "https://www.osbar.org/members/membersearch_start.asp",
  },
  {
    fips: "42",
    code: "PA",
    name: "Pennsylvania",
    lookup: "https://www.padisciplinaryboard.org/for-the-public/find-attorney",
  },
  {
    fips: "44",
    code: "RI",
    name: "Rhode Island",
    lookup: "http://rijrs.courts.ri.gov/rijrs/attorney.do",
  },
  {
    fips: "45",
    code: "SC",
    name: "South Carolina",
    lookup: "https://www.sccourts.org/attorneys/",
  },
  {
    fips: "46",
    code: "SD",
    name: "South Dakota",
    lookup: "https://www.statebarofsouthdakota.com/",
  },
  {
    fips: "47",
    code: "TN",
    name: "Tennessee",
    lookup: "https://www.tbpr.org/for-the-public/online-attorney-directory",
  },
  {
    fips: "48",
    code: "TX",
    name: "Texas",
    lookup:
      "https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer&Template=/CustomSource/MemberDirectory/Search_Form_Client_Main.cfm",
  },
  {
    fips: "49",
    code: "UT",
    name: "Utah",
    lookup: "https://services.utahbar.org/Member-Directory",
  },
  { fips: "50", code: "VT", name: "Vermont", lookup: "https://www.vermontjudiciary.org/attorneys" },
  {
    fips: "51",
    code: "VA",
    name: "Virginia",
    lookup: "https://vsb.org/Site/Shared_Content/Directory/Lookup.aspx",
  },
  {
    fips: "53",
    code: "WA",
    name: "Washington",
    lookup: "http://www.mywsba.org/PersonifyEbusiness/LegalDirectory.aspx",
  },
  {
    fips: "54",
    code: "WV",
    name: "West Virginia",
    lookup: "https://www.wvbar.org/membership-directory/",
  },
  {
    fips: "55",
    code: "WI",
    name: "Wisconsin",
    lookup: "https://www.wisbar.org/Pages/BasicLawyerSearch.aspx",
  },
  {
    fips: "56",
    code: "WY",
    name: "Wyoming",
    lookup: "https://www.wyomingbar.org/for-the-public/hire-a-lawyer/lawyer-search/",
  },
];

// Built through the `licensingSites` builder so every row gets the licensing `category`, the
// `attorneyLicense` system, `state` (the 2-letter code), and the state-FIPS jurisdiction.
export const ATTORNEY_LICENSE_SITES_BY_STATE: ReadonlyArray<{
  readonly code: string;
  readonly fipsPrefix: string;
  readonly sites: readonly AssessorSite[];
}> = ATTORNEY_LICENSE_STATES.map(({ fips, code, name, lookup }) => ({
  code,
  fipsPrefix: fips,
  sites: [licensingSites(fips, code).attorneyLicense(`${name} Attorney Search`, lookup)],
}));
