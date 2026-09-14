/*
 * How an office READS — the words the register, the record window, the picker and the link all
 * share. Pure, so what an office is called has one home and one test.
 */
import type { StatusKey } from "@magna-carta/design-system/status-register";
import { formatStoredPhone } from "$lib/directory/phone-entry.ts";
import type {
  OfficeAddress,
  OfficeAddressKind,
  OfficeStatus,
  OfficeSummary,
} from "./offices-api.ts";

/** The address kinds as a reader chooses between them. */
export const OFFICE_ADDRESS_KINDS: ReadonlyArray<{ value: OfficeAddressKind; label: string }> = [
  { value: "physical", label: "Street Address" },
  { value: "mailing", label: "Mailing Address" },
];

export function officeAddressKindLabel(kind: OfficeAddressKind): string {
  return OFFICE_ADDRESS_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

/**
 * An office's standing, in the status register's own key space. Active and Closed are the same
 * words the register already speaks for a matter, and they carry the same tones — an office that
 * has closed is finished, not destroyed.
 */
export function officeStatusKey(status: OfficeStatus): StatusKey {
  return status === "active" ? "active" : "closed";
}

/** The office's address of a kind, where it has one. */
export function officeAddressOfKind(
  office: { addresses: readonly OfficeAddress[] },
  kind: OfficeAddressKind,
): OfficeAddress | undefined {
  return office.addresses.find((address) => address.kind === kind);
}

/**
 * The address on one line, in the order it is written: the street lines, then the locality, then
 * the region and code. Empty parts are skipped rather than rendered as gaps, and an address with
 * nothing in it reads as nothing.
 */
export function officeAddressLine(address: OfficeAddress | undefined): string {
  if (address === undefined) return "";
  const parts = [
    address.street,
    address.streetTwo,
    address.dependentLocality,
    address.city,
    [address.region, address.postal].filter((part) => part !== null && part !== "").join(" "),
    address.sortingCode,
  ].filter((part): part is string => part !== null && part.trim() !== "");
  return parts.join(", ");
}

/** The town the office is in, with its region where one is recorded: "Reno, NV". */
export function officePlace(office: { addresses: readonly OfficeAddress[] }): string {
  const address = officeAddressOfKind(office, "physical") ?? officeAddressOfKind(office, "mailing");
  if (address === undefined) return "";
  return [address.city, address.region]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(", ");
}

/**
 * The office's telephone, as a person reads it. The street address's line first, because that is
 * the office's own; the mailing address's where only that has one.
 */
export function officePhoneText(office: { addresses: readonly OfficeAddress[] }): string {
  const withPhone =
    office.addresses.find((address) => address.kind === "physical" && address.phone !== null) ??
    office.addresses.find((address) => address.phone !== null);
  if (withPhone?.phone == null) return "";
  return formatStoredPhone({
    number: withPhone.phone,
    countryRegionCode: withPhone.country,
    extension: null,
  });
}

/**
 * How an office is CITED beside its name wherever it is named — the place it is in, and its
 * numbering code where the firm uses one. The name says which office; the citation says where it
 * is, which is what a reader on another office's matter wants to know.
 */
export function officeCitation(office: Pick<OfficeSummary, "addresses" | "numberCode">): string {
  return [officePlace(office), office.numberCode]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

/** Where an office's own record opens: the Offices screen, with the record named in the address. */
export function officeRecordHref(id: string): string {
  return `/settings/offices?office=${encodeURIComponent(id)}`;
}
