import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

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
