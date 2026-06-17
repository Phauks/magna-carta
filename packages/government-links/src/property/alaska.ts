import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Alaska has no counties. Its 30 county-equivalents are 19 organized boroughs (which assess property)
// plus 11 unorganized-borough census areas (no property tax, no assessor). Fourteen organized boroughs
// publish an online property search — encoded here, all search-only (several are Esri ArcGIS parcel
// viewers with no public APN-in-URL deep-link). Omitted, with no online search to wire: the five
// organized boroughs that assess offline (Aleutians East 02013, Lake and Peninsula 02164, North Slope
// 02185, Northwest Arctic 02188, Yakutat 02282) and all 11 census areas (no assessor at all).
const { search } = stateSites("AK");

export const ALASKA_ASSESSOR_SITES: readonly AssessorSite[] = [
  search("02020", "Anchorage", "https://property.muni.org/"),
  search(
    "02060",
    "Bristol Bay Borough",
    "https://experience.arcgis.com/experience/4255573aa3e1406799b625cbe85e4352",
  ),
  search(
    "02068",
    "Denali Borough",
    "https://www.arcgis.com/apps/instant/sidebar/index.html?appid=4adfc7fc3a3e48d08a41784b1a2b5aee",
  ),
  search("02090", "Fairbanks North Star Borough", "https://propertysearch.fnsb.gov/"),
  search("02100", "Haines Borough", "https://gis.hainesalaska.gov"),
  search("02110", "Juneau", "https://property.juneau.org/main/home.aspx"),
  search(
    "02122",
    "Kenai Peninsula Borough",
    "https://ak-kenai.publicaccessnow.com/Assessing/PropertySearch.aspx",
  ),
  search("02130", "Ketchikan Gateway Borough", "https://www.kgbak.us/Property-Search"),
  search("02150", "Kodiak Island Borough", "https://propaccess.kodiakak.us"),
  search("02170", "Matanuska-Susitna Borough", "https://myproperty.matsugov.us/"),
  search(
    "02195",
    "Petersburg Borough",
    "https://petersburgak.maps.arcgis.com/apps/webappviewer/index.html",
  ),
  search("02220", "Sitka", "https://www.cityofsitka.com/Home/Tabs/GIS-Map"),
  search(
    "02230",
    "Skagway",
    "https://www.arcgis.com/apps/mapviewer/index.html?webmap=f916454eacc8495d9c92630f08dff69f",
  ),
  search(
    "02275",
    "Wrangell",
    "https://wrangell.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d2f32a5f19274de99cdc782591128182",
  ),
];
