import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Oregon's 36 counties — all search-only. Oregon has rich deep-linkable portals (Helion PSO in 17
// counties, Tyler Public Access, Aumentum AscendWeb), but every one keys off the portal-native
// Account number, not the public Map-Tax-Lot a user holds — and the decision (see
// docs/research/parcels-key-model-and-resolver.md) is not to build the public-id->account resolver
// for an internal tool. So each county opens its property-search portal. A few legacy systems
// (CCI400Web in Grant/Malheur/Wallowa) serve over http on a non-standard port.
const { search } = stateSites("OR");

export const OREGON_ASSESSOR_SITES: readonly AssessorSite[] = [
  search("41001", "Baker", "https://www4.bakercountyor.gov/webproperty/Assessor_Search.html"),
  search("41003", "Benton", "https://apps.benton-or.helioncloud.com/PSO"),
  search("41005", "Clackamas", "https://ascendweb.clackamas.us/"),
  search("41007", "Clatsop", "https://apps.clatsopcounty.gov/property/"),
  search("41009", "Columbia", "https://helioncentral.com/columbiaat/MainQueryPage.aspx"),
  search("41011", "Coos", "https://records.co.coos.or.us/PSO/"),
  search("41013", "Crook", "https://pso.crookcountyor.gov/pso"),
  search("41015", "Curry", "https://currycountyor-pa.tylerhost.net/"),
  search("41017", "Deschutes", "https://dial.deschutes.org/"),
  search("41019", "Douglas", "https://appraisal.douglascountyor.gov/Home"),
  search(
    "41021",
    "Gilliam",
    "https://apps.lanecounty.org/PropertyAssessmentTaxationSearch/gilliam",
  ),
  search("41023", "Grant", "http://cci400web.com:8183/GrantCo_PropertyInq/"),
  search("41025", "Harney", "https://records.co.harney.or.us/propertywebquery/MainQueryPage.aspx"),
  search("41027", "Hood River", "https://records.co.hood-river.or.us/PSO/"),
  search("41029", "Jackson", "https://pdo.jacksoncountyor.gov/"),
  search("41031", "Jefferson", "https://public.co.umatilla.or.us/pso/"),
  search("41033", "Josephine", "https://jcpa.josephinecounty.gov/"),
  search("41035", "Klamath", "https://assessor.klamathcounty.org/PSO/"),
  search("41037", "Lake", "https://records.lakecountyor.org/pso/"),
  search("41039", "Lane", "https://www.rlid.org/custom/lc/at/"),
  search("41041", "Lincoln", "https://propertyweb.co.lincoln.or.us/PSO/"),
  search("41043", "Linn", "https://lc-helionweb.co.linn.or.us/pso/"),
  search("41045", "Malheur", "http://cci400web.com:8183/MalheurCo_PropertyInq/"),
  search("41047", "Marion", "https://mcasr.co.marion.or.us/"),
  search("41049", "Morrow", "https://records.morrowcountyor.gov/PSO/"),
  search("41051", "Multnomah", "https://multcoproptax.com/Property-Search"),
  search("41053", "Polk", "https://apps2.co.polk.or.us/PSO/"),
  search("41055", "Sherman", "https://sherman.propertytaxpayments.net/search"),
  search("41057", "Tillamook", "https://query.co.tillamook.or.us/PSO/"),
  search("41059", "Umatilla", "https://public.co.umatilla.or.us/pso/"),
  search("41061", "Union", "https://lookup.union-county.org/PSO/"),
  search("41063", "Wallowa", "http://cci400web.com:8183/WallowaCo_PropertyInq/"),
  search("41065", "Wasco", "https://public.co.wasco.or.us/webtax/"),
  search("41067", "Washington", "https://washcotax.co.washington.or.us/"),
  search("41069", "Wheeler", "https://wheelercountyoregonrecords.com/pso/"),
  search("41071", "Yamhill", "https://ascendweb.co.yamhill.or.us/AcsendWeb/"),
];
