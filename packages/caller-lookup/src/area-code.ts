// The free half of identifying a caller: where a North American number's area code was issued.
//
// Offline, synchronous and pure, so it can run anywhere a number is held — the Worker answers it
// beside the Directory match, and nothing about it needs a provider, a key or a bill.
import { NORTH_AMERICAN_AREA_CODES } from "./north-american-area-codes.ts";
import type { CallerNumber } from "./port.ts";

export interface AreaCodeRegion {
  /** The three digits, as the person would read them off the number. */
  readonly areaCode: string;
  /** A state, a province or, for a few codes, a city — what the area code was issued for. */
  readonly region: string;
}

/**
 * The area code's region, or null when the number is not North American, is not ten digits, or
 * carries a code the table does not hold. Null is an honest "not known", never a guess.
 */
export function areaCodeRegion(number: CallerNumber): AreaCodeRegion | null {
  if (number.countryCallingCode !== "1") return null;
  if (!/^[2-9][0-9]{9}$/.test(number.nationalNumber)) return null;
  const areaCode = number.nationalNumber.slice(0, 3);
  const region = NORTH_AMERICAN_AREA_CODES.get(areaCode);
  return region === undefined ? null : { areaCode, region };
}
