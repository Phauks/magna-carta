import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// California's 58 counties — the most deep-linkable state after Nevada. The deep-links come from one
// vendor cluster plus a few custom metros: Megabyte MBAP (`{host}/mbap/{slug}/asr/AsrMain/{apn}`,
// public APN in the path, dashes stripped — live-verified on Placer/Sonoma/Napa/Mono) covers ~12
// counties; Los Angeles (AIN portal), Marin (dashes kept), Nevada-CA, Santa Barbara, and Riverside
// each deep-link with their own template. Everything else is search-only — including counties whose
// deep-link needs an internal account (ParcelQuest Lite, Grant Street, Aumentum) or that only run the
// Megabyte MBC *tax* form, and the "plausible-but-unverified" ones (Solano, Sutter, Stanislaus,
// Ventura) which are kept search-only rather than ship a guessed link.
const { search, template, platform } = stateSites("CA");

const mbap = (jurisdictionId: string, name: string, host: string, slug: string): AssessorSite =>
  platform(jurisdictionId, name, `https://${host}/mbap/${slug}/asr`, "megabyteMbap", host, {
    params: { slug },
  });

export const CALIFORNIA_ASSESSOR_SITES: readonly AssessorSite[] = [
  search("06001", "Alameda", "https://propinfo.acgov.org/"),
  search("06003", "Alpine", "https://alpinecountyca.gov/405"),
  search("06005", "Amador", "https://common1.mptsweb.com/MBC/amador/tax/search"),
  search("06007", "Butte", "https://common2.mptsweb.com/mbc/butte/tax/search"),
  search("06009", "Calaveras", "https://pmaps.calaverasgov.us/"),
  search("06011", "Colusa", "https://www.countyofcolusaca.gov/15"),
  search("06013", "Contra Costa", "https://www.contracosta.ca.gov/191/Assessor"),
  search("06015", "Del Norte", "https://assr.parcelquest.com/impl/DELASSR"),
  search("06017", "El Dorado", "https://parcel.edcgov.us/"),
  search("06019", "Fresno", "https://www.fresnocountyca.gov/Departments/Assessor/Value"),
  search("06021", "Glenn", "https://assr.parcelquest.com/"),
  search("06023", "Humboldt", "https://humboldtgov.org/230"),
  search("06025", "Imperial", "https://assr.parcelquest.com/impl/IMPASSR"),
  search("06027", "Inyo", "https://assr.parcelquest.com/impl/INYASSR"),
  search("06029", "Kern", "https://assessor.co.kern.ca.us/prop_search.php"),
  mbap("06031", "Kings", "common1.mptsweb.com", "kings"),
  search("06033", "Lake", "https://gis.lakecountyca.gov/"),
  search("06035", "Lassen", "https://assr.parcelquest.com/"),
  template(
    "06037",
    "Los Angeles",
    "https://portal.assessor.lacounty.gov/",
    "https://portal.assessor.lacounty.gov/parceldetail/{apn}",
  ),
  mbap("06039", "Madera", "common1.mptsweb.com", "madera"),
  template(
    "06041",
    "Marin",
    "https://apps.marincounty.gov/TaxRollSearch",
    "https://apps.marincounty.gov/TaxRollSearch/Record?P={apn}",
    "keepSeparators",
  ),
  search("06043", "Mariposa", "https://www.mariposacounty.gov/823"),
  search(
    "06045",
    "Mendocino",
    "https://ca-mendocino.publicaccessnow.com/Assessor/PropertySearch.aspx",
  ),
  search("06047", "Merced", "https://common3.mptsweb.com/MBC/merced/tax/search"),
  search("06049", "Modoc", "https://www.co.modoc.ca.us/departments/assessor"),
  mbap("06051", "Mono", "common1.mptsweb.com", "mono"),
  search(
    "06053",
    "Monterey",
    "https://www.countyofmonterey.gov/government/departments-a-h/assessor",
  ),
  mbap("06055", "Napa", "common1.mptsweb.com", "napa"),
  template(
    "06057",
    "Nevada",
    "https://reports.nevcounty.net/property/",
    "https://reports.nevcounty.net/property/rdPage.aspx?rdReport=parcel.ParcelReport&APN={apn}",
  ),
  search("06059", "Orange", "https://assessedvalue.ocassessor.gov/"),
  mbap("06061", "Placer", "common1.mptsweb.com", "placer"),
  search("06063", "Plumas", "https://common1.mptsweb.com/MBC/plumas/tax/search"),
  template(
    "06065",
    "Riverside",
    "https://ca-riverside-acr.publicaccessnow.com/Search.aspx",
    "https://ca-riverside-acr.publicaccessnow.com/PropertySearch/Valuation.aspx?p={apn}",
  ),
  search("06067", "Sacramento", "https://eproptax.saccounty.gov/"),
  search("06069", "San Benito", "https://common2.mptsweb.com/mbc/sanbenito/tax/search"),
  search("06071", "San Bernardino", "https://arcpropertyinfo.sbcounty.gov/"),
  search("06073", "San Diego", "https://www.sdarcc.gov/"),
  search("06075", "San Francisco", "https://online.sfassessor.org/s/rp-property-search"),
  mbap("06077", "San Joaquin", "common1.mptsweb.com", "sanjoaquin"),
  search("06079", "San Luis Obispo", "https://propertyinquiryportal.slocounty.ca.gov/"),
  search(
    "06081",
    "San Mateo",
    "https://sanmateo-ca.county-taxes.com/public/search/gsgx_property_tax",
  ),
  template(
    "06083",
    "Santa Barbara",
    "https://sbcassessor.com/assessor/search.aspx",
    "https://sbcassessor.com/Assessor/details.aspx?apn={apn}",
  ),
  search(
    "06085",
    "Santa Clara",
    "https://www.sccassessor.org/index.php/online-services/property-search/real-property",
  ),
  search("06087", "Santa Cruz", "https://www2.santacruzcountyca.gov/ASR/"),
  search("06089", "Shasta", "https://common2.mptsweb.com/mbc/shasta/tax/search"),
  search("06091", "Sierra", "https://www.sierracounty.ca.gov/513/Parcel-Search"),
  search("06093", "Siskiyou", "https://assr.parcelquest.com/impl/SISASSR"),
  search("06095", "Solano", "https://ca-solano.publicaccessnow.com/Assessor/PropertySearch.aspx"),
  mbap("06097", "Sonoma", "common1.mptsweb.com", "sonoma"),
  search("06099", "Stanislaus", "https://secure.stancounty.com/AssessorWeb/public/app.jsp"),
  search("06101", "Sutter", "https://ca-sutter.publicaccessnow.com/Assessor/PropertySearch.aspx"),
  mbap("06103", "Tehama", "common1.mptsweb.com", "tehama"),
  search("06105", "Trinity", "https://assr.parcelquest.com/impl/TRIASSR"),
  mbap("06107", "Tulare", "common1.mptsweb.com", "tulare"),
  mbap("06109", "Tuolumne", "common3.mptsweb.com", "tuolumne"),
  search("06111", "Ventura", "https://assessor.venturacounty.gov/assessor-data/property-search/"),
  mbap("06113", "Yolo", "common1.mptsweb.com", "yolo"),
  mbap("06115", "Yuba", "common1.mptsweb.com", "yuba"),
];
