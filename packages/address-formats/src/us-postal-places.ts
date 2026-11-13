/*
 * Which town and state a United States ZIP code belongs to, so an address entered ZIP-first can
 * fill in the city and the state (owner request 2026-11-13: "if puts in zip code first, auto-load
 * the other information").
 *
 * A SUGGESTION, NEVER A CORRECTION. The answer only ever fills boxes that are empty; a city or state
 * somebody typed stands, because a ZIP code can cross a town line and the person entering the
 * address is the one who knows which side of it the client lives on. Where a code belongs to more
 * than one town in the data, the first one listed is offered, for the same reason: it fills a blank,
 * it does not decide.
 *
 * The table is large, so it is its own module: a consumer imports this one lazily, when a ZIP code
 * is first typed, rather than carrying it in every page that shows an address.
 */
import { US_POSTAL_PLACES } from "./data-us-postal-places.generated.ts";

/** The town and the two-letter state a ZIP code belongs to. */
export interface UsPostalPlace {
  readonly city: string;
  readonly region: string;
}

let index: Map<string, UsPostalPlace> | null = null;

function places(): Map<string, UsPostalPlace> {
  if (index !== null) return index;
  const built = new Map<string, UsPostalPlace>();
  for (const line of US_POSTAL_PLACES.split("\n")) {
    const [region, city, codes] = line.split("\t");
    if (region === undefined || city === undefined || codes === undefined) continue;
    for (const code of codes.split(",")) {
      if (!built.has(code)) built.set(code, { city, region });
    }
  }
  index = built;
  return built;
}

/**
 * The town a ZIP code belongs to, or null where the code is not five digits (a ZIP+4 is read by its
 * first five) or the data does not know it.
 */
export function usPostalPlaceFor(postalCode: string): UsPostalPlace | null {
  const digits = /^\s*(\d{5})(?:-?\d{4})?\s*$/.exec(postalCode)?.[1];
  if (digits === undefined) return null;
  return places().get(digits) ?? null;
}
