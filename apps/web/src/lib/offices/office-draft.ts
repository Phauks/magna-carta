/*
 * The office record's DRAFT — what its fields hold while somebody is entering or correcting an
 * office, and how that becomes the two requests the contract takes (the office's own fields, and
 * its address set). Pure, so the shape of a save has one home and one test, and the window owns
 * only the rendering.
 *
 * TWO ADDRESSES, EACH WITH ITS OWN TELEPHONE. The contract holds at most one street address and
 * one mailing address per office, and each carries the line the office answers on there. The draft
 * keeps both as address parts the product's one address form edits, plus the number as it is typed
 * — country, digits, extension — so it can be grouped the way the field groups it.
 */
import type { AddressParts } from "@magna-carta/design-system/address-fields";
import type { CountryCode } from "libphonenumber-js/min";
import {
  checkPhoneEntry,
  DEFAULT_PHONE_REGION,
  nationalFormOf,
  splitTypedExtension,
} from "$lib/directory/phone-entry.ts";
import type {
  OfficeAddress,
  OfficeAddressKind,
  OfficeAddressRequest,
  OfficeDetail,
  OfficeFieldsRequest,
} from "./offices-api.ts";

/** One address as the draft holds it: the lines, and the telephone as typed. */
export interface OfficeAddressDraft {
  parts: AddressParts;
  phoneRegion: string;
  phoneNumber: string;
  phoneExtension: string;
}

export interface OfficeDraft {
  name: string;
  jurisdiction: string;
  timeZone: string;
  numberCode: string;
  email: string;
  addressBlock: string;
  footer: string;
  remitTo: string;
  physical: OfficeAddressDraft;
  mailing: OfficeAddressDraft;
  /** Whether the mailing address is a separate one, or the office takes its post at the street one. */
  separateMailingAddress: boolean;
}

/** An address draft with nothing in it, in the firm's own country. */
export function emptyOfficeAddressDraft(
  country: string = DEFAULT_PHONE_REGION,
): OfficeAddressDraft {
  return { parts: { country }, phoneRegion: country, phoneNumber: "", phoneExtension: "" };
}

export function emptyOfficeDraft(country: string = DEFAULT_PHONE_REGION): OfficeDraft {
  return {
    name: "",
    jurisdiction: "",
    timeZone: "",
    numberCode: "",
    email: "",
    addressBlock: "",
    footer: "",
    remitTo: "",
    physical: emptyOfficeAddressDraft(country),
    mailing: emptyOfficeAddressDraft(country),
    separateMailingAddress: false,
  };
}

function addressDraftFrom(address: OfficeAddress | undefined, country: string): OfficeAddressDraft {
  if (address === undefined) return emptyOfficeAddressDraft(country);
  const addressCountry = address.country ?? country;
  const region = (address.country ?? DEFAULT_PHONE_REGION) as CountryCode;
  // The stored number back in the form it was typed in, with any extension split off it — the
  // record keeps `+17755550148x4102` as one string, and the field shows them as two.
  const stored = address.phone ?? "";
  const extensionAt = stored.indexOf("x");
  const bare = extensionAt === -1 ? stored : stored.slice(0, extensionAt);
  const extension = extensionAt === -1 ? "" : stored.slice(extensionAt + 1);
  const national = bare === "" ? "" : nationalFormOf(bare, region);
  const split = splitTypedExtension(region, national);
  return {
    parts: {
      country: addressCountry,
      street: address.street ?? "",
      streetTwo: address.streetTwo ?? "",
      dependentLocality: address.dependentLocality ?? "",
      city: address.city ?? "",
      region: address.region ?? "",
      postal: address.postal ?? "",
      sortingCode: address.sortingCode ?? "",
    },
    phoneRegion: region,
    phoneNumber: split.number,
    phoneExtension: extension === "" ? split.extension : extension,
  };
}

/** The draft an existing office is corrected from. */
export function officeDraftFrom(
  office: OfficeDetail,
  country: string = DEFAULT_PHONE_REGION,
): OfficeDraft {
  const physical = office.addresses.find((address) => address.kind === "physical");
  const mailing = office.addresses.find((address) => address.kind === "mailing");
  return {
    name: office.name,
    jurisdiction: office.jurisdiction ?? "",
    timeZone: office.timeZone ?? "",
    numberCode: office.numberCode ?? "",
    email: office.email ?? "",
    addressBlock: office.addressBlock ?? "",
    footer: office.footer ?? "",
    remitTo: office.remitTo ?? "",
    physical: addressDraftFrom(physical, country),
    mailing: addressDraftFrom(mailing, country),
    separateMailingAddress: mailing !== undefined,
  };
}

function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether an address draft holds any line at all. */
export function addressDraftHasContent(address: OfficeAddressDraft): boolean {
  const lines = Object.entries(address.parts).filter(([key]) => key !== "country");
  return (
    lines.some(([, value]) => (value ?? "").trim() !== "") || address.phoneNumber.trim() !== ""
  );
}

/**
 * What stops the draft being saved, in the order a reader meets the fields; empty when nothing does.
 * The name is the one thing an office cannot be without. A telephone that is not a number in its
 * country is refused where it was typed rather than stored as a string nobody can dial.
 */
export function officeDraftShortfalls(draft: OfficeDraft): readonly string[] {
  const shortfalls: string[] = [];
  if (draft.name.trim() === "") shortfalls.push("Name the office.");
  if (draft.email.trim() !== "" && !/^[^\s@]+@[^\s@]+$/u.test(draft.email.trim())) {
    shortfalls.push("The email is one address, such as reno@example.com.");
  }
  const phoneShortfall = (address: OfficeAddressDraft, which: string): void => {
    if (address.phoneNumber.trim() === "") return;
    const checked = checkPhoneEntry(
      address.phoneRegion as CountryCode,
      address.phoneNumber,
      address.phoneExtension,
    );
    if (!checked.ok) shortfalls.push(`${which}: ${checked.reason}`);
  };
  phoneShortfall(draft.physical, "Street address telephone");
  if (draft.separateMailingAddress) phoneShortfall(draft.mailing, "Mailing address telephone");
  return shortfalls;
}

/** The office's own fields, as the create and update routes take them. */
export function officeFieldsRequest(draft: OfficeDraft): OfficeFieldsRequest {
  return {
    name: draft.name.trim(),
    jurisdiction: blankToNull(draft.jurisdiction),
    timeZone: blankToNull(draft.timeZone),
    numberCode: blankToNull(draft.numberCode),
    email: blankToNull(draft.email),
    addressBlock: blankToNull(draft.addressBlock),
    footer: blankToNull(draft.footer),
    remitTo: blankToNull(draft.remitTo),
  };
}

function addressRequest(
  kind: OfficeAddressKind,
  address: OfficeAddressDraft,
): OfficeAddressRequest | null {
  if (!addressDraftHasContent(address)) return null;
  const phone =
    address.phoneNumber.trim() === ""
      ? null
      : checkPhoneEntry(
          address.phoneRegion as CountryCode,
          address.phoneNumber,
          address.phoneExtension,
        );
  return {
    kind,
    street: blankToNull(address.parts.street ?? ""),
    streetTwo: blankToNull(address.parts.streetTwo ?? ""),
    dependentLocality: blankToNull(address.parts.dependentLocality ?? ""),
    city: blankToNull(address.parts.city ?? ""),
    region: blankToNull(address.parts.region ?? ""),
    postal: blankToNull(address.parts.postal ?? ""),
    sortingCode: blankToNull(address.parts.sortingCode ?? ""),
    country: blankToNull(address.parts.country ?? "")?.toUpperCase() ?? null,
    phone: phone !== null && phone.ok ? phone.number : null,
  };
}

/**
 * The address set the save replaces the office's with. An address with nothing in it is not sent,
 * so an office whose street address was emptied ends up with none rather than with a blank row.
 */
export function officeAddressesRequest(draft: OfficeDraft): OfficeAddressRequest[] {
  const addresses: OfficeAddressRequest[] = [];
  const physical = addressRequest("physical", draft.physical);
  if (physical !== null) addresses.push(physical);
  if (draft.separateMailingAddress) {
    const mailing = addressRequest("mailing", draft.mailing);
    if (mailing !== null) addresses.push(mailing);
  }
  return addresses;
}

/** Whether two drafts say the same thing — what decides whether leaving asks first. */
export function officeDraftsEqual(left: OfficeDraft, right: OfficeDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
