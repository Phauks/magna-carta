/*
 * An office's printable sheet — the record's facts, laid out the way the print sheet lays every
 * record out. Pure, so the sheet has one shape and one test.
 */
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { timeZoneLabel } from "$lib/calendar/time-zone-options.ts";
import { formatStoredPhone } from "$lib/directory/phone-entry.ts";
import type { OfficeDetail } from "./offices-api.ts";
import {
  officeAddressKindLabel,
  officeAddressLine,
  officeCitation,
  officeStatusKey,
} from "./office-vocabulary.ts";

export function officeSheet(
  office: OfficeDetail,
  context: { readonly firmName: string | null; readonly printedAt: string },
): PrintSheetDocument {
  const facts = [
    { label: "Status", value: statusEntry(officeStatusKey(office.status)).label },
    { label: "Jurisdiction", value: office.jurisdiction ?? "" },
    { label: "Time Zone", value: office.timeZone === null ? "" : timeZoneLabel(office.timeZone) },
    { label: "Numbering Code", value: office.numberCode ?? "" },
    { label: "Email", value: office.email ?? "" },
    { label: "Firm Default", value: office.firmDefault ? "Yes" : "No" },
  ].filter((fact) => fact.value !== "");

  const addresses = office.addresses.map((address) => ({
    label: officeAddressKindLabel(address.kind),
    value: officeAddressLine(address),
    ...(address.phone === null
      ? {}
      : {
          secondary: formatStoredPhone({
            number: address.phone,
            countryRegionCode: address.country,
            extension: null,
          }),
        }),
  }));

  const letterhead = [
    { label: "Address Block", value: office.addressBlock ?? "" },
    { label: "Footer", value: office.footer ?? "" },
    { label: "Remit To", value: office.remitTo ?? "" },
    {
      label: "Mark",
      value:
        office.letterheadSource === "office"
          ? "This office's own logo"
          : office.letterheadSource === "firm"
            ? "The firm's primary mark"
            : "None",
    },
  ].filter((fact) => fact.value !== "");

  return {
    heading: office.name,
    ...(context.firmName === null ? {} : { reference: context.firmName }),
    subtitle: officeCitation(office),
    sections: [
      { id: "facts", kind: "fields", title: "Office", fields: facts },
      ...(addresses.length === 0
        ? []
        : [{ id: "addresses", kind: "fields" as const, title: "Addresses", fields: addresses }]),
      { id: "letterhead", kind: "fields", title: "Letterhead", fields: letterhead },
      ...(office.members.length === 0
        ? []
        : [
            {
              id: "members",
              kind: "fields" as const,
              title: "Members",
              fields: office.members.map((member) => ({
                label: member.displayName,
                value: member.isPrimary ? "Primary office" : "Also here",
              })),
            },
          ]),
    ],
    footer: `Printed ${context.printedAt}`,
  };
}
