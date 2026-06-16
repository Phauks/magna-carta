import type { AssessorSite } from "../types.ts";
import { netronline, stateSites } from "./helpers.ts";

// North Dakota's 53 counties. No uniform state portal, and per-county research throttled out, so each
// county routes to its NETROnline directory page (which lists that county's official assessor /
// property-search links) — guaranteeing every county is searchable. Upgrade to direct portals or
// deep-links opportunistically over time.
const { search } = stateSites("ND");

const COUNTIES: ReadonlyArray<readonly [string, string]> = [
  ["38001", "Adams"],
  ["38003", "Barnes"],
  ["38005", "Benson"],
  ["38007", "Billings"],
  ["38009", "Bottineau"],
  ["38011", "Bowman"],
  ["38013", "Burke"],
  ["38015", "Burleigh"],
  ["38017", "Cass"],
  ["38019", "Cavalier"],
  ["38021", "Dickey"],
  ["38023", "Divide"],
  ["38025", "Dunn"],
  ["38027", "Eddy"],
  ["38029", "Emmons"],
  ["38031", "Foster"],
  ["38033", "Golden Valley"],
  ["38035", "Grand Forks"],
  ["38037", "Grant"],
  ["38039", "Griggs"],
  ["38041", "Hettinger"],
  ["38043", "Kidder"],
  ["38045", "LaMoure"],
  ["38047", "Logan"],
  ["38049", "McHenry"],
  ["38051", "McIntosh"],
  ["38053", "McKenzie"],
  ["38055", "McLean"],
  ["38057", "Mercer"],
  ["38059", "Morton"],
  ["38061", "Mountrail"],
  ["38063", "Nelson"],
  ["38065", "Oliver"],
  ["38067", "Pembina"],
  ["38069", "Pierce"],
  ["38071", "Ramsey"],
  ["38073", "Ransom"],
  ["38075", "Renville"],
  ["38077", "Richland"],
  ["38079", "Rolette"],
  ["38081", "Sargent"],
  ["38083", "Sheridan"],
  ["38085", "Sioux"],
  ["38087", "Slope"],
  ["38089", "Stark"],
  ["38091", "Steele"],
  ["38093", "Stutsman"],
  ["38095", "Towner"],
  ["38097", "Traill"],
  ["38099", "Walsh"],
  ["38101", "Ward"],
  ["38103", "Wells"],
  ["38105", "Williams"],
];

export const NORTH_DAKOTA_ASSESSOR_SITES: readonly AssessorSite[] = COUNTIES.map(([fips, name]) =>
  search(fips, name, netronline("ND", name)),
);
