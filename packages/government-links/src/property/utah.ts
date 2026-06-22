import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Utah's 29 county assessors, encoding three lessons. (1) The internal-ID wall: seven counties run
// Tyler Eagle "taxweb", which deep-links only by an internal account number (not the public serial),
// so they stay search-only until a serial->account resolver exists — the same wall as Washington's
// Harris PropertyAccess and Idaho's Aumentum. (2) Adapter reuse: the GSA adapter built for Nevada
// serves Washington County unchanged. (3) The clean deep-links are a handful of bespoke county
// systems. Where no stable parcel-search URL was confirmed, the search URL is the county landing page.
const { search, template, platform } = stateSites("UT");

export const UTAH_ASSESSOR_SITES: readonly AssessorSite[] = [
  search("49001", "Beaver", "https://beaver.utah.gov/117/Assessor"),
  search(
    "49003",
    "Box Elder",
    "https://erecord.boxeldercountyut.gov/eaglesoftware/taxweb/search.jsp",
  ),
  search("49005", "Cache", "https://core.cachecounty.gov/Search/Public"),
  template(
    "49007",
    "Carbon",
    "https://carbon.utah.gov/service/property-search/",
    "https://carbon.utah.gov/Services/property-detail/?wdt_column_filter[0]={apn}",
    "keepSeparators",
  ),
  search("49009", "Daggett", "https://daggettcounty.gov/15/AssessorDMV"),
  template(
    "49011",
    "Davis",
    "https://www.daviscountyutah.gov/property-search",
    "https://www.daviscountyutah.gov/property-search/TaxInfo/{apn}",
  ),
  search("49013", "Duchesne", "https://portal.duchesnecountygis.org/"),
  search("49015", "Emery", "https://emery.utah.gov/home/offices/treasurer/tax-roll/"),
  search("49017", "Garfield", "https://garfield.utah.gov/Departments/Assessor"),
  search("49019", "Grand", "https://tax.grandcountyutah.net/"),
  search("49021", "Iron", "https://eagleweb.ironcounty.net/eaglesoftware/taxweb/search.jsp"),
  search("49023", "Juab", "https://juabcountyut-recorder.tylerhost.net/recorder/taxweb/search.jsp"),
  search("49025", "Kane", "https://eagleweb.kane.utah.gov/eaglesoftware/taxweb/search.jsp"),
  search("49027", "Millard", "https://millardcounty.gov/"),
  template(
    "49029",
    "Morgan",
    "https://taxroll.cloudapput.com/",
    "https://taxroll.cloudapput.com/?parcel={apn}",
    "keepSeparators",
  ),
  search("49031", "Piute", "https://piuteutah.com/"),
  search("49033", "Rich", "https://search.richcountyut.org/PropertyTaxSearch.aspx"),
  template(
    "49035",
    "Salt Lake",
    "https://apps.saltlakecounty.gov/assessor/new/query/query2.cfm",
    "https://apps.saltlakecounty.gov/assessor/new/javaapi2/parcelviewext.cfm?parcel_ID={apn}&query=Y",
    "keepSeparators",
  ),
  search("49037", "San Juan", "https://sanjuancountyut.gov/assessor"),
  search(
    "49039",
    "Sanpete",
    "https://erecording.sanpetecountyutah.gov/eaglesoftware/taxweb/search.jsp",
  ),
  search("49041", "Sevier", "https://qdocs.sevierutah.net/recorder/taxweb/search.jsp"),
  search("49043", "Summit", "https://property.summitcounty.org/eaglesoftware/taxweb/search.jsp"),
  search("49045", "Tooele", "https://tooeleco.gov/"),
  search(
    "49047",
    "Uintah",
    "https://apps.uintah.utah.gov/ords/r/ucdev/public-searches/property-search",
  ),
  template(
    "49049",
    "Utah",
    "https://utahcounty.gov/landrecords/SerialSearchForm.asp",
    "https://utahcounty.gov/LANDRECORDS/property.asp?av_serial={apn}",
  ),
  search("49051", "Wasatch", "https://www.wasatch.utah.gov/"),
  platform(
    "49053",
    "Washington",
    "https://washingtonco-search.gsacorp.io/",
    "gsaCorp",
    "washingtonco-search.gsacorp.io",
  ),
  search("49055", "Wayne", "https://www.waynecountyutah.org/"),
  search("49057", "Weber", "https://webercountyutah.gov/parcelsearch/"),
];
