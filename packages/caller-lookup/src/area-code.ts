// The free half of identifying a caller: where a North American number was issued, and the clock it
// was issued under.
//
// Offline, synchronous and pure, so it can run anywhere a number is held — the Worker answers it
// beside the Directory match, and nothing about it needs a provider, a key or a bill.
//
// THREE DEPTHS, EACH ANSWERED ONLY WHERE THE SOURCE KNOWS IT. The area code names a state or province;
// the exchange (the next three digits) names the town the block of numbers was assigned to; the time
// zone comes from whichever of the two the source ties a zone to. Each can be missing on its own —
// an area code the source does not subdivide has no town, and one that straddles two zones has no
// zone — and a missing one is null, never a guess.
import { NORTH_AMERICAN_AREA_CODES } from "./north-american-area-codes.ts";
import { EXCHANGES_BY_AREA_CODE, EXCHANGE_PLACES } from "./north-american-exchanges.ts";
import { NORTH_AMERICAN_TIME_ZONES } from "./north-american-time-zones.ts";
import type { CallerNumber } from "./port.ts";

export interface AreaCodeRegion {
  /** The three digits, as the person would read them off the number. */
  readonly areaCode: string;
  /** A state, a province or, for a few codes, a city — what the area code was issued for. */
  readonly region: string;
  /**
   * The town the exchange was assigned to, as the source writes it ("Las Vegas, NV"), or null where
   * the source does not subdivide this area code. Where a block of numbers was assigned, never where
   * the person holding one is now.
   */
  readonly place: string | null;
  /** The IANA time zone the number was issued under, or null where the source cannot say one. */
  readonly timeZone: string | null;
}

const exchangeTables = new Map<string, ReadonlyMap<string, string>>();

/** One area code's exchanges, unpacked the first time that area code is asked about. */
function exchangesOf(areaCode: string): ReadonlyMap<string, string> {
  const unpacked = exchangeTables.get(areaCode);
  if (unpacked !== undefined) return unpacked;
  const table = new Map<string, string>();
  const packed = EXCHANGES_BY_AREA_CODE[areaCode];
  if (packed !== undefined) {
    for (const entry of packed.split(" ")) {
      const [digits, index] = entry.split(":");
      const place = EXCHANGE_PLACES[Number.parseInt(index ?? "", 36)];
      if (digits !== undefined && place !== undefined) table.set(digits, place);
    }
  }
  exchangeTables.set(areaCode, table);
  return table;
}

function exchangePlace(nationalNumber: string): string | null {
  const exchanges = exchangesOf(nationalNumber.slice(0, 3));
  for (let length = 3; length >= 1; length -= 1) {
    const place = exchanges.get(nationalNumber.slice(3, 3 + length));
    if (place !== undefined) return place;
  }
  return null;
}

function timeZoneOf(nationalNumber: string): string | null {
  for (let length = 7; length >= 3; length -= 1) {
    const zone = NORTH_AMERICAN_TIME_ZONES.get(nationalNumber.slice(0, length));
    // An empty zone is the source saying the prefix spans several: not known, and no shorter prefix
    // may answer for it.
    if (zone !== undefined) return zone === "" ? null : zone;
  }
  return null;
}

/**
 * Where the number was issued, or null when the number is not North American, is not ten digits, or
 * carries an area code the table does not hold. Null is an honest "not known", never a guess.
 */
export function areaCodeRegion(number: CallerNumber): AreaCodeRegion | null {
  if (number.countryCallingCode !== "1") return null;
  if (!/^[2-9][0-9]{9}$/.test(number.nationalNumber)) return null;
  const areaCode = number.nationalNumber.slice(0, 3);
  const region = NORTH_AMERICAN_AREA_CODES.get(areaCode);
  if (region === undefined) return null;
  return {
    areaCode,
    region,
    place: exchangePlace(number.nationalNumber),
    timeZone: timeZoneOf(number.nationalNumber),
  };
}
