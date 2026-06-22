import type { AssessorSite } from "../types.ts";
import { businessSites } from "./helpers.ts";

// Every US state's (and DC's) Secretary-of-State business-record portals, keyed by 2-digit state FIPS
// — the office is statewide, so one row per state sits beside that state's counties' property portals
// in the shared registry. Each state has a business-entity register (the public search by company
// name); the UCC index is included where the state publishes a public search. All are search-only —
// none deep-links by entity name in the URL (deep-links are a secondary concern here). A handful run
// under a different agency than the literal Secretary of State (Arizona Corporation Commission,
// Maryland SDAT, Virginia SCC, DC DLCP, Alaska CBPL, Michigan/LARA), so the label stays the neutral
// "{State} Business Entity Search" rather than naming the agency.
interface SosState {
  readonly fips: string;
  readonly code: string;
  readonly name: string;
  readonly entitySearch: string;
  readonly uccSearch?: string;
}

// Kept sorted by FIPS.
const SOS_STATES: readonly SosState[] = [
  {
    fips: "01",
    code: "AL",
    name: "Alabama",
    entitySearch: "https://arc-sos.state.al.us/CGI/CORPNAME.MBR/INPUT",
    uccSearch: "https://www.sos.alabama.gov/business-services/ucc-home",
  },
  {
    fips: "02",
    code: "AK",
    name: "Alaska",
    entitySearch: "https://www.commerce.alaska.gov/web/cbpl/Corporations/",
    uccSearch: "https://dnr.alaska.gov/ssd/recoff/ucc",
  },
  {
    fips: "04",
    code: "AZ",
    name: "Arizona",
    entitySearch: "https://arizonabusinesscenter.azcc.gov/",
    uccSearch: "https://azsos.gov/business/ucc",
  },
  {
    fips: "05",
    code: "AR",
    name: "Arkansas",
    entitySearch: "https://portal.arkansas.gov/service/ar-entity-search/",
    uccSearch: "https://portal.arkansas.gov/service/ar-ucc-search/",
  },
  {
    fips: "06",
    code: "CA",
    name: "California",
    entitySearch: "https://bizfileonline.sos.ca.gov/search/business",
    uccSearch: "https://bizfileonline.sos.ca.gov/search/ucc",
  },
  {
    fips: "08",
    code: "CO",
    name: "Colorado",
    entitySearch: "https://www.sos.state.co.us/biz/",
    uccSearch: "https://www.sos.state.co.us/ucc/pages/recordSearch.xhtml",
  },
  {
    fips: "09",
    code: "CT",
    name: "Connecticut",
    entitySearch: "https://service.ct.gov/business/s/onlinebusinesssearch",
  },
  {
    fips: "10",
    code: "DE",
    name: "Delaware",
    entitySearch: "https://icis.corp.delaware.gov/ecorp/entitysearch/NameSearch.aspx",
    uccSearch: "https://corp.delaware.gov/uccsearch/",
  },
  {
    fips: "11",
    code: "DC",
    name: "District of Columbia",
    entitySearch: "https://dlcp.dc.gov/service/corporate-registration",
  },
  {
    fips: "12",
    code: "FL",
    name: "Florida",
    entitySearch: "https://search.sunbiz.org/inquiry/corporationsearch/byname",
    uccSearch: "https://www.floridaucc.com/",
  },
  {
    fips: "13",
    code: "GA",
    name: "Georgia",
    entitySearch: "https://ecorp.sos.ga.gov/businesssearch",
    uccSearch: "https://search.gsccca.org/UCC_Search/",
  },
  {
    fips: "15",
    code: "HI",
    name: "Hawaii",
    entitySearch: "https://hbe.ehawaii.gov/documents/search.html",
  },
  {
    fips: "16",
    code: "ID",
    name: "Idaho",
    entitySearch: "https://sosbiz.idaho.gov/search/business",
    uccSearch: "https://sosbiz.idaho.gov/search/ucc",
  },
  {
    fips: "17",
    code: "IL",
    name: "Illinois",
    entitySearch: "https://apps.ilsos.gov/corporatellc/",
    uccSearch: "https://apps.ilsos.gov/uccsearch/",
  },
  {
    fips: "18",
    code: "IN",
    name: "Indiana",
    entitySearch: "https://bsd.sos.in.gov/publicbusinesssearch",
  },
  {
    fips: "19",
    code: "IA",
    name: "Iowa",
    entitySearch: "https://sos.iowa.gov/search/business/search.aspx",
    uccSearch: "https://filings.sos.iowa.gov/UCCSearch/UCC",
  },
  {
    fips: "20",
    code: "KS",
    name: "Kansas",
    entitySearch: "https://www.sos.ks.gov/eforms/BusinessEntity/Search.aspx",
    uccSearch: "https://www.sos.ks.gov/general-services/ucc.html",
  },
  {
    fips: "21",
    code: "KY",
    name: "Kentucky",
    entitySearch: "https://sosbes.sos.ky.gov/BusSearchNProfile/search.aspx",
    uccSearch: "https://www.sos.ky.gov/bus/UCC/Pages/default.aspx",
  },
  {
    fips: "22",
    code: "LA",
    name: "Louisiana",
    entitySearch: "https://coraweb.sos.la.gov/CommercialSearch/CommercialSearch.aspx",
    uccSearch: "https://www.sos.la.gov/businessservices/ucc/",
  },
  {
    fips: "23",
    code: "ME",
    name: "Maine",
    entitySearch: "https://apps3.web.maine.gov/nei-sos-icrs/ICRS",
  },
  {
    fips: "24",
    code: "MD",
    name: "Maryland",
    entitySearch: "https://egov.maryland.gov/businessexpress/EntitySearch",
  },
  {
    fips: "25",
    code: "MA",
    name: "Massachusetts",
    entitySearch: "https://corp.sec.state.ma.us/corpweb/CorpSearch/CorpSearch.aspx",
  },
  {
    fips: "26",
    code: "MI",
    name: "Michigan",
    entitySearch: "https://www.michigan.gov/corpentitysearch",
  },
  {
    fips: "27",
    code: "MN",
    name: "Minnesota",
    entitySearch: "https://mblsportal.sos.mn.gov/Business/Search",
  },
  {
    fips: "28",
    code: "MS",
    name: "Mississippi",
    entitySearch: "https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx",
    uccSearch: "https://www.sos.ms.gov/business-services/uniform-commercial-code/ucc-search",
  },
  {
    fips: "29",
    code: "MO",
    name: "Missouri",
    entitySearch: "https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx?SearchType=0",
    uccSearch: "https://www.sos.mo.gov/ucc",
  },
  {
    fips: "30",
    code: "MT",
    name: "Montana",
    entitySearch: "https://biz.sosmt.gov/search/business",
  },
  {
    fips: "31",
    code: "NE",
    name: "Nebraska",
    entitySearch: "https://www.nebraska.gov/sos/corp/corpsearch.cgi",
  },
  {
    fips: "32",
    code: "NV",
    name: "Nevada",
    entitySearch: "https://esos.nv.gov/EntitySearch/OnlineEntitySearch",
    uccSearch: "https://projectorion.nv.gov/",
  },
  {
    fips: "33",
    code: "NH",
    name: "New Hampshire",
    entitySearch: "https://quickstart.sos.nh.gov/online/BusinessInquire",
  },
  {
    fips: "34",
    code: "NJ",
    name: "New Jersey",
    entitySearch: "https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName",
  },
  {
    fips: "35",
    code: "NM",
    name: "New Mexico",
    entitySearch: "https://enterprise.sos.nm.gov/search/business",
  },
  {
    fips: "36",
    code: "NY",
    name: "New York",
    entitySearch: "https://apps.dos.ny.gov/publicInquiry/",
  },
  {
    fips: "37",
    code: "NC",
    name: "North Carolina",
    entitySearch: "https://www.sosnc.gov/online_services/search/by_title/_Business_Registration",
  },
  {
    fips: "38",
    code: "ND",
    name: "North Dakota",
    entitySearch: "https://firststop.sos.nd.gov/search/business",
  },
  {
    fips: "39",
    code: "OH",
    name: "Ohio",
    entitySearch: "https://businesssearch.ohiosos.gov/",
  },
  {
    fips: "40",
    code: "OK",
    name: "Oklahoma",
    entitySearch: "https://www.sos.ok.gov/corp/corpInquiryFind.aspx",
  },
  {
    fips: "41",
    code: "OR",
    name: "Oregon",
    entitySearch: "https://egov.sos.state.or.us/br/pkg_web_name_srch_inq.login",
    uccSearch: "https://secure.sos.state.or.us/ucc/searchHome.action",
  },
  {
    fips: "42",
    code: "PA",
    name: "Pennsylvania",
    entitySearch: "https://file.dos.pa.gov/search/business",
  },
  {
    fips: "44",
    code: "RI",
    name: "Rhode Island",
    entitySearch: "https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx",
    uccSearch: "https://business.sos.ri.gov/CorpWeb/UccSearch/UccSearch.aspx",
  },
  {
    fips: "45",
    code: "SC",
    name: "South Carolina",
    entitySearch: "https://businessfilings.sc.gov/BusinessFiling/Entity/Search",
  },
  {
    fips: "46",
    code: "SD",
    name: "South Dakota",
    entitySearch: "https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx",
  },
  {
    fips: "47",
    code: "TN",
    name: "Tennessee",
    entitySearch: "https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx",
  },
  {
    fips: "48",
    code: "TX",
    name: "Texas",
    entitySearch: "https://www.sos.state.tx.us/corp/sosda/index.shtml",
  },
  {
    fips: "49",
    code: "UT",
    name: "Utah",
    entitySearch: "https://businessregistration.utah.gov/",
  },
  {
    fips: "50",
    code: "VT",
    name: "Vermont",
    entitySearch: "https://bizfilings.vermont.gov/online/BusinessInquire",
  },
  {
    fips: "51",
    code: "VA",
    name: "Virginia",
    entitySearch: "https://cis.scc.virginia.gov/EntitySearch/Index",
    uccSearch: "https://cis.scc.virginia.gov/UCCOnlineSearch/UCCPublicSearch",
  },
  {
    fips: "53",
    code: "WA",
    name: "Washington",
    entitySearch: "https://ccfs.sos.wa.gov/",
  },
  {
    fips: "54",
    code: "WV",
    name: "West Virginia",
    entitySearch: "https://apps.sos.wv.gov/business/corporations/",
    uccSearch: "https://apps.wv.gov/sos/ucc/",
  },
  {
    fips: "55",
    code: "WI",
    name: "Wisconsin",
    entitySearch: "https://apps.dfi.wi.gov/apps/CorpSearch/Search.aspx",
  },
  {
    fips: "56",
    code: "WY",
    name: "Wyoming",
    entitySearch: "https://wyobiz.wyo.gov/Business/FilingSearch.aspx",
    uccSearch: "https://ucc.wyo.gov/",
  },
];

// Built through the `businessSites` builder so every row gets the business `category`, the right
// `system` (businessEntity / ucc), `state` (the 2-letter code), and the state-FIPS jurisdiction.
export const SECRETARY_OF_STATE_SITES_BY_STATE: ReadonlyArray<{
  readonly code: string;
  readonly fipsPrefix: string;
  readonly sites: readonly AssessorSite[];
}> = SOS_STATES.map(({ fips, code, name, entitySearch, uccSearch }) => {
  const builder = businessSites(fips, code);
  const sites: AssessorSite[] = [
    builder.entitySearch(`${name} Business Entity Search`, entitySearch),
  ];
  if (uccSearch !== undefined) {
    sites.push(builder.uccSearch(`${name} UCC Search`, uccSearch));
  }
  return { code, fipsPrefix: fips, sites };
});
