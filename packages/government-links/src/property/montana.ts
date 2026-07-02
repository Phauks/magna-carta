import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Montana assesses property centrally (Dept. of Revenue), so there are no county assessor sites — every
// county is searchable through the one statewide Montana Cadastral portal (search by owner / geocode /
// address). Two counties expose a usefully distinct county search (Missoula, Yellowstone); the rest map
// to the statewide portal. (A geocode deep-link exists statewide but is a secondary, separate concern.)
const { search } = stateSites("MT");

const CADASTRAL = "https://svc.mt.gov/msl/cadastral/";

const COUNTIES: ReadonlyArray<readonly [string, string]> = [
  ["30001", "Beaverhead"],
  ["30003", "Big Horn"],
  ["30005", "Blaine"],
  ["30007", "Broadwater"],
  ["30009", "Carbon"],
  ["30011", "Carter"],
  ["30013", "Cascade"],
  ["30015", "Chouteau"],
  ["30017", "Custer"],
  ["30019", "Daniels"],
  ["30021", "Dawson"],
  ["30023", "Deer Lodge"],
  ["30025", "Fallon"],
  ["30027", "Fergus"],
  ["30029", "Flathead"],
  ["30031", "Gallatin"],
  ["30033", "Garfield"],
  ["30035", "Glacier"],
  ["30037", "Golden Valley"],
  ["30039", "Granite"],
  ["30041", "Hill"],
  ["30043", "Jefferson"],
  ["30045", "Judith Basin"],
  ["30047", "Lake"],
  ["30049", "Lewis and Clark"],
  ["30051", "Liberty"],
  ["30053", "Lincoln"],
  ["30055", "McCone"],
  ["30057", "Madison"],
  ["30059", "Meagher"],
  ["30061", "Mineral"],
  ["30063", "Missoula"],
  ["30065", "Musselshell"],
  ["30067", "Park"],
  ["30069", "Petroleum"],
  ["30071", "Phillips"],
  ["30073", "Pondera"],
  ["30075", "Powder River"],
  ["30077", "Powell"],
  ["30079", "Prairie"],
  ["30081", "Ravalli"],
  ["30083", "Richland"],
  ["30085", "Roosevelt"],
  ["30087", "Rosebud"],
  ["30089", "Sanders"],
  ["30091", "Sheridan"],
  ["30093", "Silver Bow"],
  ["30095", "Stillwater"],
  ["30097", "Sweet Grass"],
  ["30099", "Teton"],
  ["30101", "Toole"],
  ["30103", "Treasure"],
  ["30105", "Valley"],
  ["30107", "Wheatland"],
  ["30109", "Wibaux"],
  ["30111", "Yellowstone"],
];

const COUNTY_OVERRIDES: Readonly<Record<string, string>> = {
  "30063": "https://gis.missoulacounty.us/propertyinformation/",
  "30111":
    "https://www.yellowstonecountymt.gov/treasurer/PropertySearch/index.asp?SearchBy=Address",
};

export const MONTANA_ASSESSOR_SITES: readonly AssessorSite[] = COUNTIES.map(([fips, name]) =>
  search(fips, name, COUNTY_OVERRIDES[fips] ?? CADASTRAL),
);
