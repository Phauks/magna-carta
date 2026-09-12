/*
 * The Offices register's declarative column model — what the platform's one table is told about
 * the firm's offices. Pure: it returns columns, so what a column IS has one home and one test, and
 * the screen owns only fetching and rendering.
 *
 * The register OFFERS more columns than it SHOWS (docs/conventions/design-corrections.md, "Lists
 * and tables"): a reader asking for an office's email or its mailing address turns the column on
 * from the header menu rather than reading a table that carries every fact at once.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { timeZoneLabel } from "$lib/calendar/time-zone-options.ts";
import type { OfficeSummary } from "./offices-api.ts";
import {
  officeAddressLine,
  officeAddressOfKind,
  officePhoneText,
  officeStatusKey,
} from "./office-vocabulary.ts";

/** What the Firm Default column reads on the one row it applies to. Empty on every other. */
export const FIRM_DEFAULT_MARK = "Firm default";

export function officeColumns(): GridColumn<OfficeSummary>[] {
  return [
    // The name anchors the row: it is what an office is called out loud and searched by.
    { id: "name", label: "Office", anchored: true, value: (office) => office.name },
    {
      id: "status",
      label: "Status",
      filter: "set",
      // The register's own word, so a reader filters on "Active" and never on the storage spelling.
      filterValues: [statusEntry("active").label, statusEntry("closed").label],
      value: (office) => statusEntry(officeStatusKey(office.status)).label,
    },
    {
      id: "jurisdiction",
      label: "Jurisdiction",
      filter: "set",
      value: (office) => office.jurisdiction,
    },
    {
      id: "timeZone",
      label: "Time Zone",
      filter: "set",
      value: (office) => (office.timeZone === null ? null : timeZoneLabel(office.timeZone)),
    },
    { id: "numberCode", label: "Numbering Code", value: (office) => office.numberCode },
    {
      id: "address",
      label: "Street Address",
      value: (office) => officeAddressLine(officeAddressOfKind(office, "physical")),
    },
    { id: "phone", label: "Telephone", value: (office) => officePhoneText(office) },
    {
      id: "members",
      label: "Members",
      type: "number",
      value: (office) => office.members,
    },
    // Offered, not shown: turned on from the header menu when a reader wants them.
    { id: "email", label: "Email", hidden: true, value: (office) => office.email },
    {
      id: "mailingAddress",
      label: "Mailing Address",
      hidden: true,
      value: (office) => officeAddressLine(officeAddressOfKind(office, "mailing")),
    },
    {
      id: "letterheadLogo",
      label: "Letterhead Logo",
      hidden: true,
      filter: "set",
      filterValues: ["Own logo", "Firm's mark"],
      value: (office) => (office.hasLetterheadLogo ? "Own logo" : "Firm's mark"),
    },
    {
      id: "firmDefault",
      label: "Firm Default",
      hidden: true,
      filter: "set",
      value: (office) => (office.firmDefault ? FIRM_DEFAULT_MARK : ""),
    },
  ];
}

/** How the register opens: by name, which is how a short list of offices is read. */
export const OFFICE_REGISTER_INITIAL_SORT = { columnId: "name", direction: "ascending" } as const;

/**
 * The register's own search: the name, the place and the code, matched as a person types them.
 * Client-side, because the whole register is in hand — a firm's offices are a short list.
 */
export function officeMatchesSearch(office: OfficeSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    office.name,
    office.numberCode ?? "",
    office.jurisdiction ?? "",
    office.email ?? "",
    ...office.addresses.map((address) => officeAddressLine(address)),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
