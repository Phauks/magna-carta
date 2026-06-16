import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// South Dakota's 66 counties (FIPS 46003–46137; skips the renamed Shannon → Oglala Lakota 46102 and
// defunct Washabaugh). No statewide parcel portal — the SD DOR site is informational only. Four vendor
// families: Beacon/qPublic (Schneider) for the populous counties (true APN deep-links), Vanguard
// (`{county}.southdakotadirectors.com`), District III GIS (`gis.districtiii.org`), and First District
// MapNet (`1stdistrict.org`) — the latter three are search-page-only. Smallest counties (Bennett,
// Campbell, Harding, Mellette) have no online portal and fall back to their DOR-contact page.
const { search, platform } = stateSites("SD");

const beacon = (
  jurisdictionId: string,
  name: string,
  appId: string,
  layerId: string,
  host = "beacon.schneidercorp.com",
): AssessorSite =>
  platform(
    jurisdictionId,
    name,
    `https://${host}/Application.aspx?AppID=${appId}&LayerID=${layerId}&PageTypeID=2`,
    "beaconQpublic",
    host,
    { params: { appId, layerId } },
  );

const qpublic = (jurisdictionId: string, name: string, appId: string, layerId: string): AssessorSite =>
  beacon(jurisdictionId, name, appId, layerId, "qpublic.schneidercorp.com");

export const SOUTH_DAKOTA_ASSESSOR_SITES: readonly AssessorSite[] = [
  search("46003", "Aurora", "https://gis.districtiii.org/aurora/"),
  search("46005", "Beadle", "https://www.1stdistrict.org/beadlejs/"),
  search(
    "46007",
    "Bennett",
    "https://dor.sd.gov/government/director-of-equalization/contact-county-directors-of-equalization/",
  ),
  search("46009", "Bon Homme", "https://gis.districtiii.org/bon_homme/"),
  beacon("46011", "Brookings", "134", "1601"),
  beacon("46013", "Brown", "68", "436"),
  search("46015", "Brule", "https://gis.districtiii.org/brule/"),
  search("46017", "Buffalo", "https://gis.districtiii.org/buffalo/"),
  search("46019", "Butte", "https://buttesd.org/equalization"),
  search("46021", "Campbell", "https://dakotaathome.sd.gov/search/6b928341-3e46-51e4-9b4a-2d290c6462d4"),
  search("46023", "Charles Mix", "https://gis.districtiii.org/charles_mix/"),
  search("46025", "Clark", "https://clark.southdakotadirectors.com/"),
  beacon("46027", "Clay", "52", "348"),
  search("46029", "Codington", "https://www.1stdistrict.org/codingtonts/"),
  search("46031", "Corson", "https://corson.southdakotadirectors.com/search.php"),
  beacon("46033", "Custer", "59", "378"),
  search("46035", "Davison", "https://gis.districtiii.org/davison/"),
  search("46037", "Day", "https://gis.districtiii.org/DAY/"),
  search("46039", "Deuel", "https://www.1stdistrict.org/deueljs/"),
  search("46041", "Dewey", "https://dewey.southdakotadirectors.com/search/res/"),
  search("46043", "Douglas", "https://gis.districtiii.org/douglas/"),
  search("46045", "Edmunds", "https://www.1stdistrict.org/edmundsts/"),
  search("46047", "Fall River", "https://fallriver.southdakotadirectors.com/search/res/"),
  search("46049", "Faulk", "https://faulk.southdakotadirectors.com/search.php"),
  search("46051", "Grant", "https://www.1stdistrict.org/grantts/"),
  search("46053", "Gregory", "https://gis.districtiii.org/gregory/"),
  search("46055", "Haakon", "https://haakon.southdakotadirectors.com/search.php"),
  search("46057", "Hamlin", "https://www.1stdistrict.org/hamlints/"),
  search("46059", "Hand", "https://www.1stdistrict.org/handts/"),
  search("46061", "Hanson", "https://hanson.southdakotadirectors.com/search/res/"),
  search(
    "46063",
    "Harding",
    "https://dor.sd.gov/government/director-of-equalization/contact-county-directors-of-equalization/",
  ),
  beacon("46065", "Hughes", "940", "18376"),
  search("46067", "Hutchinson", "https://gis.districtiii.org/Hutchinson"),
  search("46069", "Hyde", "https://qpublic.schneidercorp.com/"),
  qpublic("46071", "Jackson", "746", "11496"),
  search("46073", "Jerauld", "https://jerauldcountysd.com/equalization"),
  search("46075", "Jones", "https://gis.districtiii.org/JONES/"),
  search("46077", "Kingsbury", "https://www.1stdistrict.org/kingsburyts/"),
  qpublic("46079", "Lake", "335", "4059"),
  search(
    "46081",
    "Lawrence",
    "https://beacon.schneidercorp.com/Application.aspx?App=LawrenceCountySD&PageType=Search",
  ),
  search("46083", "Lincoln", "https://gis.lincolncountysd.gov/parcel-browser/"),
  search("46085", "Lyman", "https://gis.districtiii.org/Lyman/"),
  beacon("46087", "McCook", "95", "951"),
  search("46089", "McPherson", "https://mcpherson.sdcounties.org/director-of-equalization/"),
  search("46091", "Marshall", "https://gis.districtiii.org/marshall"),
  beacon("46093", "Meade", "53", "17891"),
  search("46095", "Mellette", "https://mellette.sdcounty.gov/departments/director-of-equalization/"),
  search("46097", "Miner", "https://www.1stdistrict.org/minerts/"),
  beacon("46099", "Minnehaha", "1180", "35026"),
  search("46101", "Moody", "https://www.1stdistrict.org/moodyjs/"),
  search("46102", "Oglala Lakota", "https://oglalalakota.southdakotadirectors.com/search.php"),
  search("46103", "Pennington", "http://property.pennco.org/"),
  search("46105", "Perkins", "https://perkins.southdakotadirectors.com/search/res/"),
  search("46107", "Potter", "https://potter.southdakotadirectors.com/search.php"),
  search("46109", "Roberts", "https://www.1stdistrict.org/robertsjs/"),
  search("46111", "Sanborn", "https://gis.districtiii.org/sanborn/"),
  search("46115", "Spink", "http://spinkcounty-sd.org/equalization.html"),
  search("46117", "Stanley", "https://gis.districtiii.org/stanley/"),
  search("46119", "Sully", "https://gis.districtiii.org/sully/"),
  search("46121", "Todd", "https://gis.districtiii.org/tripp_todd/"),
  search("46123", "Tripp", "https://gis.districtiii.org/tripp_todd/"),
  search("46125", "Turner", "https://gis.districtiii.org/turner/"),
  beacon("46127", "Union", "66", "428"),
  qpublic("46129", "Walworth", "847", "15533"),
  beacon("46135", "Yankton", "358", "4767"),
  search("46137", "Ziebach", "https://ziebachcounty.org/assessor"),
];
