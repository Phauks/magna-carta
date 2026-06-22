import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Idaho's 44 counties — the lesson state: zero clean APN URL-deep-links anywhere. Most counties run
// opaque ArcGIS Experience / Web AppBuilder map viewers (no per-parcel URL), and the only
// deep-link-capable cluster (Aumentum publicaccessnow: Canyon, Kootenai, Payette) keys on an internal
// account, not the public parcel id — so every county is search-only. Per the longevity preference,
// each points at a stable county .gov assessor/GIS landing page rather than a fragile opaque-id
// widget. Lewis serves over http only (absent https cert); Ada and Lincoln sit behind bot challenges
// (they load in a browser, not headless fetchers) — both noted for the future liveness checker.
const { search } = stateSites("ID");

export const IDAHO_ASSESSOR_SITES: readonly AssessorSite[] = [
  search(
    "16001",
    "Ada",
    "https://adacounty.id.gov/assessor/property-assessments-records/assessors-property-records/",
  ),
  search("16003", "Adams", "https://www.co.adams.id.us/department/assessor/gis-maps"),
  search("16005", "Bannock", "https://www.bannockcounty.gov/assessor/"),
  search("16007", "Bear Lake", "https://www.bearlakecounty.info/assessor.html"),
  search("16009", "Benewah", "https://www.benewahcountyid.gov/departments/assessor"),
  search("16011", "Bingham", "https://www.binghamid.gov/InteractiveGISMapping"),
  search("16013", "Blaine", "https://www.blainecountyid.gov/168/Assessor"),
  search("16015", "Boise", "https://property.boisecounty.us/"),
  search("16017", "Bonner", "https://www.bonnercountyid.gov/departments/assessor/PropertySearch"),
  search("16019", "Bonneville", "https://www.bonnevillecountyidaho.gov/page/platting-and-mapping"),
  search("16021", "Boundary", "https://boundarycountyid.org/site-page/assessor"),
  search("16023", "Butte", "https://buttecountyid.us/officials/assessor/"),
  search("16025", "Camas", "https://tax.idaho.gov/taxes/property/gis/data-maps/parcel-maps/"),
  search("16027", "Canyon", "https://id-canyon.publicaccessnow.com/Assessor/PropertySearch.aspx"),
  search("16029", "Caribou", "https://www.cariboucounty.us/departments/assessor/index.php"),
  search("16031", "Cassia", "https://proptax.cassia.gov/"),
  search("16033", "Clark", "https://www.clark-co.id.gov/assessor"),
  search(
    "16035",
    "Clearwater",
    "https://www.clearwatercounty.org/departments/gis_and_mapping/parcels.php",
  ),
  search("16037", "Custer", "https://custercountyidaho.org/departments/assessor/"),
  search("16039", "Elmore", "https://elmorecounty.org/assessor/"),
  search("16041", "Franklin", "https://www.franklincountyidaho.org/departments/assessor.php"),
  search("16043", "Fremont", "https://maps.terragis.net/fremontid/"),
  search("16045", "Gem", "https://www.gemcounty.org/departments_offices/county_assessor/index.php"),
  search("16047", "Gooding", "https://www.goodingcounty.org/150/Assessors-Office"),
  search("16049", "Idaho", "https://idahocounty.org/planb/assessor/"),
  search("16051", "Jefferson", "https://www.jcgov.us/176/Assessor"),
  search("16053", "Jerome", "https://www.jeromecountyid.us/149/Assessor"),
  search("16055", "Kootenai", "https://id-kootenai.publicaccessnow.com/Assessor.aspx"),
  search("16057", "Latah", "https://latahcountyid.gov/assessor/"),
  search("16059", "Lemhi", "https://www.lemhicountyidaho.org/232/Assessor"),
  search("16061", "Lewis", "http://www.lewiscountyid.us/Elected-Officials/Assessor"),
  search("16063", "Lincoln", "https://www.lincolncountyid.gov/assessor"),
  search("16065", "Madison", "https://co.madison.id.us/departments/assessor/"),
  search("16067", "Minidoka", "https://www.minidoka.id.us/150/Assessor"),
  search("16069", "Nez Perce", "https://www.co.nezperce.id.us/Elected-Officials/Assessor"),
  search("16071", "Oneida", "https://www.oneidaid.us/departments/assessor/index.php"),
  search("16073", "Owyhee", "https://owyheecounty.net/departments/assessor/"),
  search("16075", "Payette", "https://id-payette.publicaccessnow.com/Assessor/PropertySearch.aspx"),
  search("16077", "Power", "https://www.powercounty.gov/196/Assessor"),
  search("16079", "Shoshone", "https://shoshonecounty.id.gov/assessor/"),
  search(
    "16081",
    "Teton",
    "https://tetoncountyidaho.gov/government/elected_officials/assessor_-_property_values/index.php",
  ),
  search("16083", "Twin Falls", "https://twinfallscounty.org/assessor/"),
  search("16085", "Valley", "https://www.co.valley.id.us/departments/AssessorsOffice"),
  search("16087", "Washington", "https://www.co.washington.id.us/152/Assessor"),
];
