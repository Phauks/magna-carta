/*
 * A directory record as a contact card: the vCard (RFC 6350, version 4.0) a phone, a mail program
 * or another firm's system reads, so a person's way of being reached can leave the platform in the
 * one shape everything else already accepts.
 *
 * WHAT GOES ON THE CARD IS WHAT A RECIPIENT MAY USE. A card is handed on, so it carries the name and
 * the live ways of reaching someone and nothing the firm holds about them in confidence: no sealed
 * identifiers, no matters, no relationships, no notes. A contact point the person withdrew
 * permission for, or one recorded as former, stays off it — a card that hands on a number the
 * person asked the firm not to ring repeats the mistake in someone else's address book.
 *
 * Pure, so the rule can be asserted without a browser; the entity window hands the text to the
 * one download seam (apps/web/src/lib/export/tabular-export.ts).
 */
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import {
  entityPhotoHref,
  readDirectoryEntityPhoto,
  type DirectoryAddressEntry,
  type DirectoryAddressUse,
  type DirectoryContactPoints,
  type DirectoryContactUse,
  type DirectoryEmailEntry,
  type DirectoryEntityDetail,
  type DirectoryPhoneEntry,
} from "./directory-api.ts";
import { directoryEntityName } from "./entity-presentation.ts";

/** The media type a contact card is saved as. */
export const CONTACT_CARD_CONTENT_TYPE = "text/vcard";

/** The longest a card's line may run, in octets, before it is folded onto the next. */
const LINE_OCTET_LIMIT = 75;

/** A property value with the four characters vCard reserves escaped. */
function escapeValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** A structured value: components joined by semicolons, each escaped on its own. */
function structured(components: readonly (string | null | undefined)[]): string {
  return components.map((component) => escapeValue(component?.trim() ?? "")).join(";");
}

/**
 * A content line folded at the octet limit, never inside a character. Continuation lines open with
 * one space, which a reader removes when it unfolds them.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let piece = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    // A continuation line spends one octet on its leading space.
    const limit = pieces.length === 0 ? LINE_OCTET_LIMIT : LINE_OCTET_LIMIT - 1;
    if (octets + size > limit) {
      pieces.push(piece);
      piece = "";
      octets = 0;
    }
    piece += character;
    octets += size;
  }
  pieces.push(piece);
  return pieces.join("\r\n ");
}

/** Whether a contact point belongs on a card a recipient will use. */
function usable(entry: {
  readonly state: { readonly permitted: boolean };
  readonly contactUse?: DirectoryContactUse | null;
  readonly addressUse?: DirectoryAddressUse | null;
}): boolean {
  if (!entry.state.permitted) return false;
  return entry.contactUse !== "former" && entry.addressUse !== "former";
}

/** The parameters every contact point shares: its kind of use, and whether it comes first. */
function parameters(types: readonly string[], preferred: boolean): string {
  const parts: string[] = [];
  if (types.length > 0) parts.push(`TYPE=${types.join(",")}`);
  if (preferred) parts.push("PREF=1");
  return parts.length === 0 ? "" : `;${parts.join(";")}`;
}

/** vCard names only work and home; the firm's finer uses fold into those two or into none. */
function useType(use: DirectoryContactUse | DirectoryAddressUse | null): string | null {
  switch (use) {
    case "work":
    case "business":
    case "registered":
    case "service":
      return "work";
    case "home":
    case "residential":
      return "home";
    default:
      return null;
  }
}

function emailLine(entry: DirectoryEmailEntry): string {
  const type = useType(entry.contactUse);
  const types = type === null ? [] : [type];
  return `EMAIL${parameters(types, entry.isPrimary)}:${escapeValue(entry.address)}`;
}

function phoneLine(entry: DirectoryPhoneEntry): string {
  const types: string[] = [];
  const type = useType(entry.contactUse);
  if (type !== null) types.push(type);
  if (entry.contactUse === "mobile") types.push("cell");
  if (entry.contactSystem === "voice") types.push("voice");
  if (entry.contactSystem === "fax") types.push("fax");
  if (entry.contactSystem === "sms") types.push("text");
  if (entry.contactSystem === "pager") types.push("pager");
  // The number exactly as it was entered: it is what the firm was given and what the screen shows.
  const number = entry.extension === null ? entry.number : `${entry.number} x${entry.extension}`;
  return `TEL${parameters(types, entry.isPrimary)}:${escapeValue(number)}`;
}

function addressLine(entry: DirectoryAddressEntry): string {
  const type = useType(entry.addressUse);
  const types = type === null ? [] : [type];
  // Two street lines are one component, a line break between them, as a label prints them.
  const street = [entry.street, entry.streetTwo]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line !== "")
    .join("\n");
  const locality = [entry.dependentLocality, entry.city]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(", ");
  // Post-office box and extended address stay empty: the firm holds neither apart from the street.
  const value = structured(["", "", street, locality, entry.region, entry.postal, entry.country]);
  return `ADR${parameters(types, entry.isPrimary)}:${value}`;
}

/** A plain calendar date, YYYY-MM-DD, in the basic form a card's date takes. */
function cardDate(date: string): string | null {
  return isCivilDate(date) ? date.replaceAll("-", "") : null;
}

/** The record's picture, ready to embed: its media type and its bytes as base64. */
export interface ContactCardPhoto {
  readonly contentType: string;
  readonly base64: string;
}

/**
 * The record's picture for its card, or null where it holds none or the bytes could not be read. A
 * card without its picture is still the card, so a failed read leaves the picture off rather than
 * refusing the download.
 */
export async function readContactCardPhoto(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ContactCardPhoto | null> {
  const facts = await readDirectoryEntityPhoto(fetchImpl, entityId);
  if (facts.kind !== "ok" || facts.value.photo === null) return null;
  try {
    const response = await fetchImpl(entityPhotoHref(entityId, facts.value.photo));
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return { contentType: facts.value.photo.contentType, base64: btoa(binary) };
  } catch {
    return null;
  }
}

/** The card's text, every line folded and ended with CRLF as the format requires. */
export function contactCard(
  entity: DirectoryEntityDetail,
  contactPoints: DirectoryContactPoints | null,
  photo: ContactCardPhoto | null = null,
): string {
  const lines = ["BEGIN:VCARD", "VERSION:4.0"];
  lines.push(`FN:${escapeValue(directoryEntityName(entity))}`);
  if (entity.kind === "person") {
    const person = entity.person;
    lines.push(
      `N:${structured([person.family, person.given, person.middle, person.prefix, person.suffix])}`,
    );
    const birthday = person.dateOfBirth === null ? null : cardDate(person.dateOfBirth);
    if (birthday !== null) lines.push(`BDAY:${birthday}`);
  } else {
    lines.push("KIND:org");
    const organization = entity.organization;
    const legal = organization.legalName?.trim() ?? "";
    lines.push(`ORG:${escapeValue(legal === "" ? directoryEntityName(entity) : legal)}`);
  }
  // The picture as a data address, the form version 4.0 takes, so the card stands on its own.
  if (photo !== null) lines.push(`PHOTO:data:${photo.contentType};base64,${photo.base64}`);
  if (contactPoints !== null) {
    for (const entry of contactPoints.emails.filter(usable)) lines.push(emailLine(entry));
    for (const entry of contactPoints.phones.filter(usable)) lines.push(phoneLine(entry));
    for (const entry of contactPoints.addresses.filter(usable)) lines.push(addressLine(entry));
  }
  lines.push("END:VCARD");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** The file a card is saved as: the record's name, stripped of what a file system refuses. */
export function contactCardFilename(entity: DirectoryEntityDetail): string {
  // Control characters (below a space) are refused as well as the punctuation a file system reserves.
  const name = Array.from(directoryEntityName(entity), (character) =>
    character.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(character) ? " " : character,
  )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return `${name === "" ? "Contact" : name}.vcf`;
}
