import { writeFileSync } from "node:fs";
import { todayInUtc } from "@magna-carta/civil-time/civil-date";

// Refreshes docs/research/address-formats/corpus.json from the address-internationalization data
// service — the corpus Chromium and the Android/iOS address widgets are built from, and the same one
// `libaddressinput` ships. Run: `pnpm --filter @magna-carta/address-formats run fetch:corpus`.
//
// THE CORPUS IS CHECKED IN, AND THAT IS THE POINT. The service is a live endpoint that goes stale,
// moves, and occasionally changes a country's shape; a build that fetched it would be a build whose
// output depends on a third party being up, and a postal-code rule that changed under a release
// nobody made. So the fetch is a deliberate, reviewable act that produces a diff, and everything
// downstream reads the committed file. The date of the last refresh is recorded in the corpus itself.
//
// Refresh cadence is a judgement call rather than a schedule: postal-code formats and administrative
// areas move on the order of years, and a country's entry changing is a thing to read rather than to
// take. Re-run it when a country is reported wrong, or when adding one the corpus did not carry.

const SERVICE = "https://chromium-i18n.appspot.com/ssl-address/data";
const OUT_URL = new URL("../../../docs/research/address-formats/corpus.json", import.meta.url);

/** One country as the service returns it. Every field is optional — most countries carry few. */
interface ServiceEntry {
  readonly key?: string;
  readonly name?: string;
  readonly zip?: string;
  readonly zipex?: string;
  readonly posturl?: string;
  readonly zip_name_type?: string;
  readonly state_name_type?: string;
  readonly sub_keys?: string;
  readonly sub_names?: string;
}

async function getJson(url: string): Promise<ServiceEntry & { countries?: string }> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as ServiceEntry & { countries?: string };
}

// The service separates list values with "~" rather than a comma, because a country or region name
// may itself contain one ("Korea, Republic of"). Splitting on the wrong character is the mistake this
// helper exists to make impossible to repeat.
function tilde(value: string | undefined): readonly string[] {
  if (value === undefined || value === "") return [];
  return value.split("~").map((part) => part.trim());
}

const root = await getJson(SERVICE);
const countryCodes = tilde(root.countries);
if (countryCodes.length === 0) throw new Error("the service returned no country list");

const corpus: Record<string, unknown> = {};
for (const code of countryCodes) {
  const entry = await getJson(`${SERVICE}/${code}`);
  // sub_keys are the values a record STORES; sub_names are what a reader sees. A country that gives
  // no sub_names stores the name itself (Ireland's "Co. Carlow"), so the two collapse to one value.
  const keys = tilde(entry.sub_keys);
  const names = tilde(entry.sub_names);
  const administrativeAreas = keys.map((key, index) => ({ code: key, name: names[index] ?? key }));
  const projected: Record<string, unknown> = { name: entry.name ?? code };
  if (entry.zip !== undefined) projected.postalPattern = entry.zip;
  if (entry.zipex !== undefined) {
    projected.postalExamples = entry.zipex
      .split(",")
      .map((one) => one.trim())
      .filter(Boolean);
  }
  // Research-only provenance: kept here so a reader can check a rule against its source and see what
  // a country calls its own fields, and dropped by build-data.mts because the shipped model needs
  // neither — the words an address form uses are the design system's (address-format.ts).
  if (entry.posturl !== undefined) projected.postalLookupUrl = entry.posturl;
  if (entry.zip_name_type !== undefined) projected.postalNameType = entry.zip_name_type;
  if (entry.state_name_type !== undefined)
    projected.administrativeAreaNameType = entry.state_name_type;
  if (administrativeAreas.length > 0) projected.administrativeAreas = administrativeAreas;
  corpus[code] = projected;
}

const document = {
  source: SERVICE,
  retrievedOn: todayInUtc(),
  countries: corpus,
};
writeFileSync(OUT_URL, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${countryCodes.length} countries to ${OUT_URL.pathname}`);
