import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Wyoming's 23 counties — dominated by Greenwood Map / TerraGIS interactive map viewers (search-only,
// no APN-in-URL). Only Goshen exposes a clean public deep-link (Schneider Beacon/qPublic). Greenwood's
// legacy `maps.greenwoodmap.com` hosts have aging TLS certs; TerraGIS hosts are preferred where given.
const { search, platform } = stateSites("WY");

export const WYOMING_ASSESSOR_SITES: readonly AssessorSite[] = [
  search("56001", "Albany", "https://maps.greenwoodmap.com/albany/map"),
  search("56003", "Big Horn", "https://maps.greenwoodmap.com/bighorn/mapserver/"),
  search("56005", "Campbell", "https://propertysearch.campbellcountywy.gov/"),
  search("56007", "Carbon", "https://www.carboncountywy.gov/936/County-Assessor"),
  search("56009", "Converse", "https://maps.greenwoodmap.com/converse/map"),
  search("56011", "Crook", "https://www.crookcounty.wy.gov/elected_officials/assessor/"),
  search("56013", "Fremont", "https://maps.terragis.net/fremontwy/"),
  platform(
    "56015",
    "Goshen",
    "https://beacon.schneidercorp.com/Application.aspx?AppID=1095&LayerID=27134&PageTypeID=2&PageID=10999",
    "beaconQpublic",
    "beacon.schneidercorp.com",
    { params: { appId: "1095", layerId: "27134" } },
  ),
  search("56017", "Hot Springs", "https://maps.greenwoodmap.com/hotsprings/mapserver/map"),
  search("56019", "Johnson", "https://maps.greenwoodmap.com/johnson/"),
  search("56021", "Laramie", "https://maps.terragis.net/laramie/"),
  search(
    "56023",
    "Lincoln",
    "https://www.lincolncountywy.gov/government/assessor/property_details_search.php",
  ),
  search("56025", "Natrona", "https://propsearch.natronacounty-wy.gov/"),
  search(
    "56027",
    "Niobrara",
    "https://www.niobraracounty.org/_departments/_assessor/parcel_viewer.asp",
  ),
  search("56029", "Park", "https://maps.terragis.net/park/"),
  search("56031", "Platte", "https://maps.terragis.net/platte/"),
  search("56033", "Sheridan", "https://maps.terragis.net/sheridan/"),
  search("56035", "Sublette", "https://maps.greenwoodmap.com/sublette/"),
  search("56037", "Sweetwater", "https://maps.terragis.net/sweetwater/"),
  search("56039", "Teton", "https://gis.tetoncountywy.gov/"),
  search("56041", "Uinta", "https://maps.terragis.net/uinta/mapserver/"),
  search("56043", "Washakie", "https://maps.greenwoodmap.com/washakie/map"),
  search("56045", "Weston", "https://www.westongov.com/county-assessor/property-detail-search/"),
];
