import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Arizona's 15 county assessors. Unlike Nevada, no shared deep-link platform spans the state: six
// counties run Tyler EagleWeb (POST-based search, no public GET-by-parcel), the rest are bespoke
// ASP.NET/GIS apps, and only Maricopa (Phoenix) exposes a stable parcel deep-link. So every county
// opens its search page except Maricopa, which deep-links by APN. URLs verified against the live
// assessor sites; the lower-confidence ones (Cochise, Santa Cruz, Greenlee) are worth re-checking
// if they break.
const { search, template } = stateSites("AZ");

export const ARIZONA_ASSESSOR_SITES: readonly AssessorSite[] = [
  search(
    "04001",
    "Apache",
    "https://eagleassessor.co.apache.az.us/assessor/taxweb/search.jsp?guest=true",
  ),
  search("04003", "Cochise", "https://asr.cochise.gov/"),
  search("04005", "Coconino", "https://apps.coconino.az.gov/assessor/ASPublic/Search.aspx"),
  search("04007", "Gila", "https://assessor.gilacountyaz.gov/assessor/web/"),
  search("04009", "Graham", "https://www.graham.az.gov/491/Parcel-Info-Search"),
  search(
    "04011",
    "Greenlee",
    "https://parcelsearch.greenlee.az.gov/Production/RealWareDataMartPropertyInquiryWebsite/Inquiry.aspx",
  ),
  search("04012", "La Paz", "https://publicrecords.lapazassessor.com/assessor/web/"),
  template(
    "04013",
    "Maricopa",
    "https://mcassessor.maricopa.gov/",
    "https://mcassessor.maricopa.gov/mcs/?q={apn}",
  ),
  search("04015", "Mohave", "https://www.mohave.gov/departments/assessor/assessor-search/"),
  search("04017", "Navajo", "https://www.navajocountyaz.gov/661/Property-Tax---Map-Search"),
  search("04019", "Pima", "https://gis.pima.gov/maps/landbase/parsrch.htm"),
  search("04021", "Pinal", "https://www.pinal.gov/686/Parcel-Search"),
  search(
    "04023",
    "Santa Cruz",
    "https://parcelsearch.santacruzcountyaz.gov/santacruzwebpay/propertyinformation",
  ),
  search("04025", "Yavapai", "https://gis.yavapai.us/v4/search.aspx"),
  search("04027", "Yuma", "https://yumacountyaz-assessor.tylerhost.net/assessor/web/"),
];
