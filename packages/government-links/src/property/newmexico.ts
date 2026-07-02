import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// New Mexico's 33 counties — overwhelmingly Tyler EagleWeb (session/servlet-bound, parcel detail keyed
// on an internal account, never the public UPC → search-only). Only Bernalillo (Tyler iasWorld, public
// UPC) and Santa Fe (legacy PHP) deep-link by the public parcel id. Four counties have no online search
// (De Baca, Hidalgo, Mora, Quay) and fall back to a county assessor page; several hosts are http-only.
const { search, template } = stateSites("NM");

export const NEW_MEXICO_ASSESSOR_SITES: readonly AssessorSite[] = [
  template(
    "35001",
    "Bernalillo",
    "https://assessor.bernco.gov/public.access/search/commonsearch.aspx?mode=realprop",
    "https://assessor.bernco.gov/public.access/Datalets/Datalet.aspx?UseSearch=no&pin={apn}",
  ),
  search("35003", "Catron", "https://catroncountynm-assessor.tylerhost.net/assessor/web/"),
  search(
    "35005",
    "Chaves",
    "https://www.chavescounty.gov/your-county/departments/assessor-s-office/gis-property-search",
  ),
  search("35006", "Cibola", "https://www.cibolacountynm.com/departments/assessor/"),
  search("35007", "Colfax", "http://68.66.87.241/assessor/web/"),
  search("35009", "Curry", "http://lookup.currycounty.org:8080/assessor.aspx"),
  search("35011", "De Baca", "https://www.debacacountynm.gov/"),
  search("35013", "Doña Ana", "https://assessor.donaanacounty.org/assessor/taxweb/search.jsp"),
  search("35015", "Eddy", "https://liveassessor.co.eddy.nm.us/assessor/web/"),
  search("35017", "Grant", "https://grantcountynm.com:8443/assessor/taxweb/search.jsp"),
  search("35019", "Guadalupe", "http://67.209.192.152/assessor.aspx"),
  search("35021", "Harding", "https://portico.mygisonline.com/html5/?viewer=hardingnm"),
  search("35023", "Hidalgo", "https://hidalgocounty.org/assessor/"),
  search("35025", "Lea", "http://liveweb.leacounty-nm.org/assessor.aspx?source=assessor"),
  search("35027", "Lincoln", "https://portico.mygisonline.com/html5/?viewer=lincolnnm"),
  search("35028", "Los Alamos", "https://eagleweb.losalamosnm.us/assessor/web/"),
  search("35029", "Luna", "https://records.lunacountynm.us/assessor.aspx"),
  search("35031", "McKinley", "http://eagleweb.co.mckinley.nm.us/assessor/web/"),
  search("35033", "Mora", "https://www.countyofmora.com/county-assessor"),
  search("35035", "Otero", "https://oterocountynm-asrweb.tylerhost.net/assessor/web/"),
  search("35037", "Quay", "https://www.quaycounty-nm.gov/assessor/"),
  search("35039", "Rio Arriba", "https://rac-ew-asr.rio-arriba.org/assessor/web/"),
  search("35041", "Roosevelt", "https://rooseveltcountynm-assessor.tylerhost.net/assessor/web/"),
  search(
    "35043",
    "Sandoval",
    "https://eaweb.sandovalcountynm.gov/Assessor/web/loginPOST.jsp?guest=true",
  ),
  search("35045", "San Juan", "https://sanjuancountynm-eaweb.tylerhost.net/assessor/web/"),
  search("35047", "San Miguel", "https://erecording.smcounty.net:8444/assessor/web/"),
  template(
    "35049",
    "Santa Fe",
    "https://assessor.santafecountynm.gov/",
    "https://assessor.santafecountynm.gov/map_retired.php?searchType=ParcelNumber&searchValue={apn}",
  ),
  search("35051", "Sierra", "https://liveweb.sierraco.org"),
  search("35053", "Socorro", "https://socorrocountynm-assessor.tylerhost.net/assessor/taxweb/"),
  search("35055", "Taos", "http://lookup.taoscounty.org/assessor.aspx?source=assessor"),
  search("35057", "Torrance", "https://torrancecountynm-assessor.tylerhost.net/assessor/web/"),
  search("35059", "Union", "https://unioncountynm-assessor.tylerhost.net/assessor/web/splash.jsp"),
  search("35061", "Valencia", "https://valenciacountynm-assessorweb.tylerhost.net/assessor/web/"),
];
