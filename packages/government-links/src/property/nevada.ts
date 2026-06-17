import type { AssessorSite } from "../types.ts";
import { gisSites, recorderSites, stateSites } from "./helpers.ts";

// Nevada's 17 county-equivalents (16 counties + the consolidated Carson City), each pointing at its
// online assessor property search. The whole state runs just three site families, so the rows are
// nearly all one-liners over the shared platform adapters:
//  - DevNet Wedge (now Catalis) — 9 counties, host pattern `{county}nv.devnetwedge.com`.
//  - GSA Corp / GovStack — 6 counties, some on `{county}-search.gsacorp.io`, some county-branded.
//  - Custom — Clark and Washoe (the two metros) each run a bespoke site with its own deep-link.
// Jurisdiction ids are the standard Census county FIPS codes (state 32; Carson City is 32510, the
// successor to the dissolved Ormsby County 32025). Hosts verified against the live assessor sites;
// Washoe's SPA `parid` param and Elko's live load are lower-confidence and worth re-checking.
const { template, platform } = stateSites("NV");

const devnet = (jurisdictionId: string, name: string, host: string): AssessorSite =>
  platform(jurisdictionId, name, `https://${host}/`, "devnetWedge", host);

const gsa = (jurisdictionId: string, name: string, host: string): AssessorSite =>
  platform(jurisdictionId, name, `https://${host}/`, "gsaCorp", host);

export const NEVADA_ASSESSOR_SITES: readonly AssessorSite[] = [
  devnet("32510", "Carson City", "carsoncitynv.devnetwedge.com"),
  devnet("32001", "Churchill", "churchillnv.devnetwedge.com"),
  template(
    "32003",
    "Clark",
    "https://www.clarkcountynv.gov/government/assessor/property_search/",
    "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ParcelDetail.aspx?hdnParcel={apn}",
  ),
  gsa("32005", "Douglas", "douglasnv-search.gsacorp.io"),
  devnet("32007", "Elko", "elkonv.devnetwedge.com"),
  devnet("32009", "Esmeralda", "esmeraldanv.devnetwedge.com"),
  gsa("32011", "Eureka", "eureka-search.gsacorp.io"),
  gsa("32013", "Humboldt", "humboldt-search.gsacorp.io"),
  gsa("32015", "Lander", "lander-search.gsacorp.io"),
  gsa("32017", "Lincoln", "prs.lincolncountynv.gov"),
  gsa("32019", "Lyon", "gsaportal.lyon-county.org"),
  devnet("32021", "Mineral", "mineralnv.devnetwedge.com"),
  devnet("32023", "Nye", "nyenv-assessor.devnetwedge.com"),
  devnet("32027", "Pershing", "pershingnv.devnetwedge.com"),
  devnet("32029", "Storey", "storeynv.devnetwedge.com"),
  template(
    "32031",
    "Washoe",
    "https://www.washoecounty.gov/assessor/cama/index.php",
    "https://www.washoecounty.gov/assessor/cama/?parid={apn}",
  ),
  devnet("32033", "White Pine", "whitepinenv.devnetwedge.com"),
];

// Recorder (deeds / liens) — each county recorder's official-records search (Landmark, Tyler ROD,
// AcclaimWeb, ICRIS, or a department page). Search-only; deed images are paywalled. Lincoln County's
// recorder search isn't separately online (its assessor portal `prs.lincolncountynv.gov` is encoded
// above), so it is omitted here — 16 of 17.
const recorder = recorderSites("NV").search;

export const NEVADA_RECORDER_SITES: readonly AssessorSite[] = [
  recorder("32001", "Churchill", "https://landmark.churchillcounty.org/LandmarkWeb/"),
  recorder("32003", "Clark", "https://recorderecomm.clarkcountynv.gov/AcclaimWeb/"),
  recorder("32005", "Douglas", "https://apps.douglas.co.us/LandmarkWeb/"),
  recorder(
    "32007",
    "Elko",
    "https://www.elkocountynv.net/departments/recorder/recorder/public_records.php",
  ),
  recorder(
    "32009",
    "Esmeralda",
    "https://www.accessesmeralda.com/county_offices/auditor_recorder/index.php",
  ),
  recorder(
    "32011",
    "Eureka",
    "https://www.eurekacountynv.gov/departments/clerk-recorder/search-recorders-official-documents/",
  ),
  recorder("32013", "Humboldt", "https://www.humboldtcountynv.gov/197/Recorders-Office"),
  recorder("32015", "Lander", "http://www.landercounty.org:1401/cgi-bin/diw200"),
  recorder("32019", "Lyon", "https://www.lyon-county.org/110/Online-Records"),
  recorder("32021", "Mineral", "http://mineral.nv.gov/government/recorder.php"),
  recorder("32023", "Nye", "https://nyecountynv-recorder.tylerhost.net/recorder/web/login.jsp"),
  recorder("32027", "Pershing", "https://selfservice.pershingcountynv.gov/"),
  recorder(
    "32029",
    "Storey",
    "https://storeycountynv-kiosk.tylerhost.net/clerkkiosk/search/DOCSEARCH159S1",
  ),
  recorder("32031", "Washoe", "https://icris.washoecounty.us/ssrecorder/"),
  recorder("32033", "White Pine", "https://www.whitepinecounty.net/298/Recorder"),
  recorder("32510", "Carson City", "https://landmark.carsoncity.gov/LandmarkWeb/"),
];

// GIS (parcel map) — only where a portal exists distinct from the assessor's parcel search (8
// counties; the rest use the assessor search as their map and are not duplicated here).
const gis = gisSites("NV").search;

export const NEVADA_GIS_SITES: readonly AssessorSite[] = [
  gis("32003", "Clark", "https://clarkcountygis-ccgismo.hub.arcgis.com/"),
  gis("32007", "Elko", "https://gis.elkocountynv.net/"),
  gis("32011", "Eureka", "https://eucogis.maps.arcgis.com/apps/webappviewer/"),
  gis("32013", "Humboldt", "https://humboldtnv.maps.arcgis.com/apps/webappviewer/"),
  gis("32017", "Lincoln", "https://tax.lincolncountynv.gov/map/"),
  gis(
    "32023",
    "Nye",
    "https://portico.sidwellco.com/portal/apps/experiencebuilder/experience/?id=97ac158a96c44fdca6e2fde93c109087",
  ),
  gis("32031", "Washoe", "https://gis.washoecounty.us/wrms/"),
  gis("32510", "Carson City", "https://carsoncitynv.mapgeo.io/"),
];
