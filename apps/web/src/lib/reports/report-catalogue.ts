/*
 * The Reports catalogue — the report registry projected into the shared catalogue vocabulary
 * ($lib/catalogue), which is what the /reports screen renders.
 *
 * Nothing about a report is decided here. The registry owns the family, the name, the question the
 * report answers, its stage and what an unbuilt one waits on; this module only says which of those
 * fills which part of a catalogue entry. A report that can be run is a link to its run screen; one
 * nobody has built goes nowhere and carries its dependency, which is the standing rule that a
 * designed-but-unwired surface ships visible and honest rather than omitted or faked live.
 */
import type { CatalogueEntry, CatalogueSection } from "../catalogue/catalogue.ts";
import {
  isBuiltReport,
  reportHref,
  reportsInFamily,
  REPORT_FAMILIES,
  type ReportDeclaration,
} from "./report-registry.ts";

/** Where the reports catalogue remembers whether this browser reads it as tiles or as rows. */
export const REPORTS_VIEW_STORAGE_KEY = "mc-reports-view";

function catalogueEntry(report: ReportDeclaration, icon: CatalogueEntry["icon"]): CatalogueEntry {
  return {
    id: report.id,
    name: report.name,
    description: report.answers,
    stage: report.stage,
    icon,
    href: isBuiltReport(report) ? reportHref(report) : null,
    ...(isBuiltReport(report) ? {} : { waitsOn: report.waitsOn }),
    // The permission is what the server enforces on the read, and it is also the vocabulary a
    // member is likeliest to have met in the access screens — so "reports:financial" reaches the
    // financial reports here without ever being printed on a row.
    keywords: [report.permission],
  };
}

/**
 * Every declared report, grouped by family in the order the registry names the families. A family
 * nothing is declared under is omitted rather than shown as an empty heading — the same rule the
 * tool catalogue's grouping applies to a subject group with no permitted tool in it.
 */
export function reportCatalogueSections(): readonly CatalogueSection[] {
  return REPORT_FAMILIES.map((family) => ({
    id: family.id,
    label: family.label,
    entries: reportsInFamily(family.id).map((report) => catalogueEntry(report, family.icon)),
  })).filter((section) => section.entries.length > 0);
}
