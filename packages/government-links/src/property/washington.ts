import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Washington's 39 county assessors — a different vendor ecosystem from the Southwest. Three patterns
// dominate: TerraScan TaxSifter (deep-linkable by parcel via `?q=`), Harris PropertyAccess (whose
// detail page is keyed on an internal id, not the APN, so it is search-only until a resolver exists),
// and a spread of bespoke county systems (several of which expose a clean deep-link). None of the
// Southwest platforms (DevNet/GSA/Beacon) appear in Washington. URLs from live-site research;
// confidence varies — the internal-id and reCAPTCHA-gated systems are deliberately left search-only.
const { search, template, platform } = stateSites("WA");

const taxSifter = (
  jurisdictionId: string,
  name: string,
  host: string,
  basePath?: string,
): AssessorSite =>
  platform(
    jurisdictionId,
    name,
    `https://${host}${basePath ?? ""}/`,
    "terraScanTaxSifter",
    host,
    basePath ? { params: { basePath } } : undefined,
  );

export const WASHINGTON_ASSESSOR_SITES: readonly AssessorSite[] = [
  taxSifter("53001", "Adams", "adamswa-taxsifter.publicaccessnow.com"),
  search("53003", "Asotin", "https://propertysearch.trueautomation.com/PropertyAccess/?cid=10"),
  search("53005", "Benton", "https://propertysearch.co.benton.wa.us/propertyaccess/?cid=0"),
  search("53007", "Chelan", "https://pacs.co.chelan.wa.us/propertyaccess/"),
  search("53009", "Clallam", "https://websrv22.clallam.net/propertyaccess/"),
  search("53011", "Clark", "https://gis.clark.wa.gov/gishome/property/"),
  search("53013", "Columbia", "https://64.184.153.98/PropertyAccess/"),
  search("53015", "Cowlitz", "https://cowlitzinfo.net/CowlitzPropertyApp/"),
  taxSifter("53017", "Douglas", "douglaswa-taxsifter.publicaccessnow.com"),
  taxSifter("53019", "Ferry", "ferrywa-taxsifter.publicaccessnow.com"),
  taxSifter("53021", "Franklin", "terra.co.franklin.wa.us", "/taxsifter"),
  search("53023", "Garfield", "https://nemrc.info/web_data/wagarf/searchT.php"),
  taxSifter("53025", "Grant", "grantwa-taxsifter.publicaccessnow.com"),
  taxSifter("53027", "Grays Harbor", "graysharborwa-taxsifter.publicaccessnow.com"),
  search("53029", "Island", "https://assessor.islandcountywa.gov/propertyaccess/"),
  search("53031", "Jefferson", "https://trueweb.jeffcowa.us/propertyaccess/"),
  template(
    "53033",
    "King",
    "https://blue.kingcounty.com/Assessor/eRealProperty/",
    "https://blue.kingcounty.com/Assessor/eRealProperty/Detail.aspx?ParcelNbr={apn}",
  ),
  search("53035", "Kitsap", "https://psearch.kitsap.gov/psearch/"),
  taxSifter("53037", "Kittitas", "taxsifter.co.kittitas.wa.us"),
  search("53039", "Klickitat", "https://klickitatcountytreasurer.org/propertysearch.aspx"),
  template(
    "53041",
    "Lewis",
    "https://parcels.lewiscountywa.gov/",
    "https://parcels.lewiscountywa.gov/{apn}",
  ),
  taxSifter("53043", "Lincoln", "lincolnwa-taxsifter.publicaccessnow.com"),
  search("53045", "Mason", "https://property.masoncountywa.gov/TaxSifter/"),
  taxSifter("53047", "Okanogan", "okanoganwa-taxsifter.publicaccessnow.com"),
  taxSifter("53049", "Pacific", "pacificwa-taxsifter.publicaccessnow.com"),
  search("53051", "Pend Oreille", "https://taweb.pendoreille.org/PropertyAccess/?cid=0"),
  search("53053", "Pierce", "https://atip.piercecountywa.gov/app/v2/parcelSearch/search"),
  search("53055", "San Juan", "https://parcel.sanjuancountywa.gov/PropertyAccess/"),
  template(
    "53057",
    "Skagit",
    "https://skagitcounty.net/Search/Property/",
    "https://skagitcounty.net/Search/Property/?rt=details&fn={apn}",
  ),
  taxSifter("53059", "Skamania", "skamaniawa-taxsifter.publicaccessnow.com"),
  search(
    "53061",
    "Snohomish",
    "https://wa-snohomish.publicaccessnow.com/PropertyInformation/PropertySearch.aspx",
  ),
  template(
    "53063",
    "Spokane",
    "https://cp.spokanecounty.org/scout/propertyinformation/",
    "https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID={apn}",
    "keepSeparators",
  ),
  search("53065", "Stevens", "https://propertysearch.trueautomation.com/PropertyAccess/?cid=0"),
  template(
    "53067",
    "Thurston",
    "https://tcproperty.co.thurston.wa.us/propsql/front_s.asp",
    "https://tcproperty.co.thurston.wa.us/propsql/basic_p.asp?pn={apn}",
  ),
  search("53069", "Wahkiakum", "https://apo.co.wahkiakum.wa.us/propertyaccess/"),
  search(
    "53071",
    "Walla Walla",
    "https://propertysearch.co.walla-walla.wa.us/PropertyAccess/?cid=0",
  ),
  search("53073", "Whatcom", "https://property.whatcomcounty.us/propertyaccess/"),
  taxSifter("53075", "Whitman", "terrascan.whitmancounty.net", "/taxsifter"),
  template(
    "53077",
    "Yakima",
    "https://yes.co.yakima.wa.us/AssessorAPI/Property_Search.html",
    "https://yes.co.yakima.wa.us/AssessorAPI/Property_Search.html?pn={apn}",
    "keepSeparators",
  ),
];
