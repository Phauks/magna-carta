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

/** The area code as a reader says it: where the number was issued, never where the caller is. */
export function areaCodeLine(areaCode: { areaCode: string; region: string }): string {
  return `${areaCode.areaCode} · ${areaCode.region} number`;
}
