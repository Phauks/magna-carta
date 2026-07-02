import type { AssessorSite } from "../types.ts";
import { counties, stateSites } from "./helpers.ts";

// Nevada — the reference template for a fully-built, multi-system state. County-centric: one `nv.add`
// per county carries its assessor (DevNet Wedge / GSA Corp / a custom deep-link) plus the county's
// recorder (deeds/liens search). The registry consumes the two derived arrays at the bottom. 17
// county-equivalents (16 counties + the consolidated Carson City 32510, successor to the dissolved
// Ormsby County 32025); all 17 carry a recorder. The two property systems we curate are assessor and
// recorder — the ones with consistent, linkable official portals and direct legal value (ownership /
// valuation, and title / encumbrances). County GIS parcel viewers are deliberately out of scope: the
// platforms are too disparate to link usefully and mostly duplicate the assessor's own map. The `gis`
// system stays a dormant engine seam (helpers/registry) in case a land-use practice ever wants it.
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
    "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/pcl.aspx",
    "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ParcelDetail.aspx?hdnParcel={apn}",
  ),
  { recorder: "https://recorderecomm.clarkcountynv.gov/AcclaimWeb/" },
);
nv.add(gsa("32005", "Douglas", "douglasnv-search.gsacorp.io"), {
  recorder: "https://apps.douglas.co.us/LandmarkWeb/",
});
nv.add(gsa("32007", "Elko", "elko-search.gsacorp.io"), {
  recorder: "https://records.elkocountynv.net/Landmark",
});
nv.add(devnet("32009", "Esmeralda", "esmeraldanv.devnetwedge.com"), {
  recorder: "http://recorder.accessesmeralda.com/DigitalResearchRoom",
});
nv.add(gsa("32011", "Eureka", "eureka-search.gsacorp.io"), {
  recorder: "https://recording.eurekacountynv.gov/DigitalResearchRoomPublic/",
});
nv.add(gsa("32013", "Humboldt", "humboldt-search.gsacorp.io"), {
  recorder: "https://recorder.humboldtcountynv.gov:8443/",
});
nv.add(gsa("32015", "Lander", "lander-search.gsacorp.io"), {
  recorder: "http://www.landercounty.org:1401/cgi-bin/diw200",
});
nv.add(gsa("32017", "Lincoln", "prs.lincolncountynv.gov"), {
  recorder: "https://recording.lincolncountynv.org:8443/DigitalResearchRoom",
});
nv.add(gsa("32019", "Lyon", "gsaportal.lyon-county.org"), {
  recorder: "https://records.lyon-county.org/web/search/DOCSEARCH197S2",
});
nv.add(devnet("32021", "Mineral", "mineralnv.devnetwedge.com"), {
  recorder: "https://records.mineralcountynv.us/web/",
});
nv.add(devnet("32023", "Nye", "nyenv-assessor.devnetwedge.com"), {
  recorder: "https://nyecountynv-recorder.tylerhost.net/recorder/eagleweb/docSearch.jsp",
});
nv.add(devnet("32027", "Pershing", "pershingnv.devnetwedge.com"), {
  recorder: "https://selfservice.pershingcountynv.gov/web/search/DOCSEARCH140S1",
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
  { recorder: "https://icris.washoecounty.us/ssrecorder/" },
);
nv.add(devnet("32033", "White Pine", "whitepinenv.devnetwedge.com"), {
  recorder: "https://recorder.whitepinecountynv.gov:444/DigitalResearchRoom",
});
nv.add(devnet("32510", "Carson City", "carsoncitynv.devnetwedge.com"), {
  recorder: "https://landmark.carsoncity.gov/LandmarkWeb/",
});

export const NEVADA_ASSESSOR_SITES: readonly AssessorSite[] = nv.assessors();
export const NEVADA_RECORDER_SITES: readonly AssessorSite[] = nv.recorders();
