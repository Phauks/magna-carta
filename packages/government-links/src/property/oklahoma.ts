import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Oklahoma's 77 counties. Three shared portals dominate, all search-only (internal-id keyed):
// actDataScout (`/RealProperty/Oklahoma/{County}`), AIS okcountydata (`county.asp?county={County}&s=R`),
// and Spatialest (`/ok/{county}/`); plus DataCrosspoint and a few county-custom systems. Only Tulsa
// (public account-number deep-link) and Woodward (qPublic/Beacon) deep-link by the public parcel.
const { search, template, platform } = stateSites("OK");

const okdata = (jurisdictionId: string, name: string, code: string): AssessorSite =>
  search(jurisdictionId, name, `https://www.okcountydata.com/county.asp?county=${code}&s=R`);

const actData = (jurisdictionId: string, name: string, slug: string): AssessorSite =>
  search(jurisdictionId, name, `https://www.actdatascout.com/RealProperty/Oklahoma/${slug}`);

const spatialest = (jurisdictionId: string, name: string, slug: string): AssessorSite =>
  search(jurisdictionId, name, `https://property.spatialest.com/ok/${slug}/`);

export const OKLAHOMA_ASSESSOR_SITES: readonly AssessorSite[] = [
  okdata("40001", "Adair", "Adair"),
  search("40003", "Alfalfa", "https://oklmrecords.com/alfalfa/"),
  search("40005", "Atoka", "https://mapview-online.com/Atoka/"),
  search("40007", "Beaver", "https://oklmrecords.com/beaver/"),
  okdata("40009", "Beckham", "Beckham"),
  actData("40011", "Blaine", "Blaine"),
  actData("40013", "Bryan", "Bryan"),
  actData("40015", "Caddo", "Caddo"),
  spatialest("40017", "Canadian", "canadian"),
  actData("40019", "Carter", "Carter"),
  okdata("40021", "Cherokee", "Cherokee"),
  okdata("40023", "Choctaw", "Choctaw"),
  okdata("40025", "Cimarron", "Cimarron"),
  spatialest("40027", "Cleveland", "cleveland"),
  okdata("40029", "Coal", "Coal"),
  actData("40031", "Comanche", "Comanche"),
  okdata("40033", "Cotton", "Cotton"),
  actData("40035", "Craig", "Craig"),
  search("40037", "Creek", "https://www.creekcountyonline.com/assessor"),
  search("40039", "Custer", "https://app.datacrosspoint.com/properties/Custer"),
  spatialest("40041", "Delaware", "delaware"),
  okdata("40043", "Dewey", "Dewey"),
  okdata("40045", "Ellis", "Ellis"),
  spatialest("40047", "Garfield", "garfield"),
  okdata("40049", "Garvin", "Garvin"),
  okdata("40051", "Grady", "Grady"),
  actData("40053", "Grant", "Grant"),
  okdata("40055", "Greer", "Greer"),
  okdata("40057", "Harmon", "Harmon"),
  okdata("40059", "Harper", "Harper"),
  actData("40061", "Haskell", "Haskell"),
  okdata("40063", "Hughes", "Hughes"),
  actData("40065", "Jackson", "Jackson"),
  search("40067", "Jefferson", "https://app.datacrosspoint.com/properties/Jefferson"),
  okdata("40069", "Johnston", "Johnston"),
  actData("40071", "Kay", "Kay"),
  okdata("40073", "Kingfisher", "Kingfisher"),
  okdata("40075", "Kiowa", "Kiowa"),
  search("40077", "Latimer", "https://app.datacrosspoint.com/properties/latimer"),
  actData("40079", "Le Flore", "LeFlore"),
  okdata("40081", "Lincoln", "Lincoln"),
  search("40083", "Logan", "https://www.logancountyok.com/234/Search-Assessors-Records"),
  actData("40085", "Love", "Love"),
  spatialest("40087", "McClain", "mcclain"),
  actData("40089", "McCurtain", "McCurtain"),
  actData("40091", "McIntosh", "McIntosh"),
  actData("40093", "Major", "Major"),
  actData("40095", "Marshall", "Marshall"),
  actData("40097", "Mayes", "Mayes"),
  okdata("40099", "Murray", "Murray"),
  actData("40101", "Muskogee", "Muskogee"),
  actData("40103", "Noble", "Noble"),
  okdata("40105", "Nowata", "Nowata"),
  actData("40107", "Okfuskee", "Okfuskee"),
  search("40109", "Oklahoma", "https://docs.oklahomacounty.org/AssessorWP5/DefaultSearch.asp"),
  okdata("40111", "Okmulgee", "Okmulgee"),
  actData("40113", "Osage", "Osage"),
  okdata("40115", "Ottawa", "Ottawa"),
  okdata("40117", "Pawnee", "Pawnee"),
  spatialest("40119", "Payne", "payne"),
  actData("40121", "Pittsburg", "Pittsburg"),
  okdata("40123", "Pontotoc", "Pontotoc"),
  actData("40125", "Pottawatomie", "Pottawatomie"),
  okdata("40127", "Pushmataha", "Pushmataha"),
  okdata("40129", "Roger Mills", "Roger+Mills"),
  search("40131", "Rogers", "https://www.rogerscounty.org/188/Assessor"),
  actData("40133", "Seminole", "Seminole"),
  actData("40135", "Sequoyah", "Sequoyah"),
  okdata("40137", "Stephens", "Stephens"),
  actData("40139", "Texas", "Texas"),
  okdata("40141", "Tillman", "Tillman"),
  template(
    "40143",
    "Tulsa",
    "https://assessor.tulsacounty.org/Property/Search",
    "https://assessor.tulsacounty.org/Property/Info?accountNo={apn}",
  ),
  spatialest("40145", "Wagoner", "wagoner"),
  search("40147", "Washington", "https://washingtoncountyok.gov/"),
  okdata("40149", "Washita", "Washita"),
  okdata("40151", "Woods", "Woods"),
  platform(
    "40153",
    "Woodward",
    "https://beacon.schneidercorp.com/Application.aspx?AppID=824&LayerID=14896&PageTypeID=2&PageID=6589",
    "beaconQpublic",
    "beacon.schneidercorp.com",
    { params: { appId: "824", layerId: "14896" } },
  ),
];
