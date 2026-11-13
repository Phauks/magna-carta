/*
 * Who is on the other end of a number — the logic, kept apart from any markup so the same answer can
 * be drawn under the number field today and in a side panel of the record window later.
 *
 * Calls `communications.callerLookup` and `communications.callerIdentity` through the generated
 * client. The first is free and is asked as soon as the typed number is
 * a complete one; the second is a billed query to the carriers' caller-name database and is asked
 * only when a person presses for it. The server keeps that answer, so the next time the number is
 * typed it arrives with the free read and nobody is offered the button again.
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import {
  communicationsCallerIdentity,
  communicationsCallerLookup,
  type CallerIdentity as MaybeCallerIdentity,
  type CallerIdentityLookup,
  type CallerLookup,
} from "@magna-carta/api-client";
import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type {
  CallerDirectoryMatch,
  CallerIdentityLookup,
  CallerLookup,
} from "@magna-carta/api-client";

/** A caller ID the firm holds; the contract's own shape is nullable, because it may hold none. */
export type CallerIdentity = NonNullable<MaybeCallerIdentity>;
export type CallerLineType = NonNullable<CallerIdentity["lineType"]>;

/**
 * The number to ask about, in E.164, or null while what has been typed is not yet a whole number.
 *
 * VALID, NOT MERELY POSSIBLE. The field itself accepts a possible number so a person is never blocked
 * mid-entry, but a lookup fired on every possible prefix would ask the server about numbers nobody
 * dialled. The extension is left off: it reaches a desk behind the number, and the Directory and the
 * caller-name database both know the number, not the desk.
 */
export function lookupNumberFor(region: string, typed: string): string | null {
  if (typed.trim() === "") return null;
  const parsed = parsePhoneNumberFromString(typed, region as CountryCode);
  if (parsed === undefined || !parsed.isValid()) return null;
  return parsed.number;
}

/** Everything known about a number that costs nothing. Read-shaped POST: the number is a client's. */
export async function readCallerLookup(number: string): Promise<ApiOutcome<CallerLookup>> {
  try {
    const { data } = await communicationsCallerLookup({ body: { number }, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** The paid caller-ID query. One key per press, so a retried press is the same press. */
export async function lookUpCallerIdentity(
  number: string,
  idempotencyKey: string,
): Promise<ApiOutcome<CallerIdentityLookup>> {
  try {
    const { data } = await communicationsCallerIdentity({
      body: { number },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

const LINE_TYPE_LABELS: Record<CallerLineType, string> = {
  mobile: "Mobile",
  fixed: "Landline",
  fixedOrMobile: "Landline or mobile",
  voip: "Internet phone",
  tollFree: "Toll-free",
  other: "Other line",
};

export function lineTypeLabel(lineType: CallerLineType): string {
  return LINE_TYPE_LABELS[lineType];
}

/**
 * The caller ID as one line: the name as the network gave it, then the kind of line.
 *
 * The name is shown exactly as the database holds it, upper case and all. It is what the phone's
 * screen would have said, and reshaping it ("Smith John" from "SMITH JOHN") would make a carrier's
 * record look like a name somebody at the firm wrote down.
 */
export function callerIdentityLine(identity: CallerIdentity): string {
  const name = identity.callerName ?? "No name on record";
  return identity.lineType === null ? name : `${name} · ${lineTypeLabel(identity.lineType)}`;
}

/** The free answer about where a number was issued, as the contract carries it. */
export type CallerAreaCode = NonNullable<CallerLookup["areaCode"]>;

/**
 * Where the number was issued, as a reader says it: "702 · Henderson, Nevada". It sits under the
 * number, so the line does not say "number" again.
 *
 * The town comes from the exchange and the state from the area code. The numbering data writes the
 * town with a postal abbreviation ("Henderson, NV"); that is dropped for the region's full name,
 * which the line already carries, and a town that IS the region (Washington in "Washington D.C.")
 * is not said twice. Worded as where the number was issued, never where the caller is: a mobile
 * number keeps its exchange when its owner moves.
 */
export function areaCodeLine(areaCode: CallerAreaCode): string {
  const town = areaCode.place?.replace(/, [A-Z]{2}$/, "") ?? null;
  const where =
    town === null || town === "" || areaCode.region.includes(town)
      ? areaCode.region
      : `${town}, ${areaCode.region}`;
  return `${areaCode.areaCode} · ${where}`;
}

/**
 * The time where the number was issued, for deciding whether now is a sensible hour to call back:
 * "3:19 PM PST". The zone abbreviation is what says the clock is the number's, not the reader's. Null where the number's zone is not known, which is better than a clock in the
 * wrong zone.
 */
export function localTimeLine(areaCode: CallerAreaCode, now: Date): string | null {
  if (areaCode.timeZone === null) return null;
  return formatTimeOfDay(now, { timeZone: areaCode.timeZone, zoneName: true });
}
