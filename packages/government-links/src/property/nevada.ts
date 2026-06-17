import type { AssessorSite } from "../types.ts";
import { counties, stateSites } from "./helpers.ts";

// Nevada — the reference template for a fully-built, multi-system state. County-centric: one `nv.add`
// per county carries its assessor (DevNet Wedge / GSA Corp / a custom deep-link) plus the county's
// recorder (deeds/liens search) and, where distinct from the assessor, its GIS parcel viewer. The
// registry consumes the three derived arrays at the bottom. 17 county-equivalents (16 counties + the
// consolidated Carson City 32510, successor to the dissolved Ormsby County 32025).
//
// Coverage notes worth keeping: Lincoln's recorder isn't separately online (its assessor portal
// `prs.lincolncountynv.gov` is the GSA search), so it carries GIS but no recorder. Counties without a
// `gis` use their assessor parcel search as the map (not duplicated): Churchill, Douglas, Esmeralda,
// Lander, Lyon, Mineral, Pershing, Storey, White Pine. Recorder = 16, distinct GIS = 8.
const { template, platform } = stateSites("NV");

const devnet = (jurisdictionId: string, name: string, host: string): AssessorSite =>
  platform(jurisdictionId, name, `https://${host}/`, "devnetWedge", host);

const gsa = (jurisdictionId: string, name: string, host: string): AssessorSite =>
  platform(jurisdictionId, name, `https://${host}/`, "gsaCorp", host);

const nv = counties("NV");

nv.add(devnet("32001", "Churchill", "churchillnv.devnetwedge.com"), {
  recorder: "https://landmark.churchillcounty.org/LandmarkWeb/",
});
nv.add(
  template(
    "32003",
    "Clark",
    "https://www.clarkcountynv.gov/government/assessor/property_search/",
    "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ParcelDetail.aspx?hdnParcel={apn}",
  ),
  {
    recorder: "https://recorderecomm.clarkcountynv.gov/AcclaimWeb/",
    gis: "https://clarkcountygis-ccgismo.hub.arcgis.com/",
  },
);
nv.add(gsa("32005", "Douglas", "douglasnv-search.gsacorp.io"), {
  recorder: "https://apps.douglas.co.us/LandmarkWeb/",
});
nv.add(devnet("32007", "Elko", "elkonv.devnetwedge.com"), {
  recorder: "https://www.elkocountynv.net/departments/recorder/recorder/public_records.php",
  gis: "https://gis.elkocountynv.net/",
});
nv.add(devnet("32009", "Esmeralda", "esmeraldanv.devnetwedge.com"), {
  recorder: "https://www.accessesmeralda.com/county_offices/auditor_recorder/index.php",
});
nv.add(gsa("32011", "Eureka", "eureka-search.gsacorp.io"), {
  recorder:
    "https://www.eurekacountynv.gov/departments/clerk-recorder/search-recorders-official-documents/",
  gis: "https://eucogis.maps.arcgis.com/apps/webappviewer/",
});
nv.add(gsa("32013", "Humboldt", "humboldt-search.gsacorp.io"), {
  recorder: "https://www.humboldtcountynv.gov/197/Recorders-Office",
  gis: "https://humboldtnv.maps.arcgis.com/apps/webappviewer/",
});
nv.add(gsa("32015", "Lander", "lander-search.gsacorp.io"), {
  recorder: "http://www.landercounty.org:1401/cgi-bin/diw200",
});
nv.add(gsa("32017", "Lincoln", "prs.lincolncountynv.gov"), {
  gis: "https://tax.lincolncountynv.gov/map/",
});
nv.add(gsa("32019", "Lyon", "gsaportal.lyon-county.org"), {
  recorder: "https://www.lyon-county.org/110/Online-Records",
});
nv.add(devnet("32021", "Mineral", "mineralnv.devnetwedge.com"), {
  recorder: "http://mineral.nv.gov/government/recorder.php",
});
nv.add(devnet("32023", "Nye", "nyenv-assessor.devnetwedge.com"), {
  recorder: "https://nyecountynv-recorder.tylerhost.net/recorder/web/login.jsp",
  gis: "https://portico.sidwellco.com/portal/apps/experiencebuilder/experience/?id=97ac158a96c44fdca6e2fde93c109087",
});
nv.add(devnet("32027", "Pershing", "pershingnv.devnetwedge.com"), {
  recorder: "https://selfservice.pershingcountynv.gov/",
});
nv.add(devnet("32029", "Storey", "storeynv.devnetwedge.com"), {
  recorder: "https://storeycountynv-kiosk.tylerhost.net/clerkkiosk/search/DOCSEARCH159S1",
});
nv.add(
  template(
    "32031",
    "Washoe",
    "https://www.washoecounty.gov/assessor/cama/index.php",
    "https://www.washoecounty.gov/assessor/cama/?parid={apn}",
  ),
  {
    recorder: "https://icris.washoecounty.us/ssrecorder/",
    gis: "https://gis.washoecounty.us/wrms/",
  },
);
nv.add(devnet("32033", "White Pine", "whitepinenv.devnetwedge.com"), {
  recorder: "https://www.whitepinecounty.net/298/Recorder",
});
nv.add(devnet("32510", "Carson City", "carsoncitynv.devnetwedge.com"), {
  recorder: "https://landmark.carsoncity.gov/LandmarkWeb/",
  gis: "https://carsoncitynv.mapgeo.io/",
});

export const NEVADA_ASSESSOR_SITES: readonly AssessorSite[] = nv.assessors();
export const NEVADA_RECORDER_SITES: readonly AssessorSite[] = nv.recorders();
export const NEVADA_GIS_SITES: readonly AssessorSite[] = nv.gisPortals();
