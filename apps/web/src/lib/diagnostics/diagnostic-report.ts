/*
 * ONE SHAPE FOR EVERY PASTE-READY DIAGNOSIS IN THE APP.
 *
 * Two surfaces assemble a block of facts for somebody else to read — the issue reporter's trace
 * (./failure-trace.ts) and the header's Build Information panel ($lib/versions/panel-report.ts) —
 * and until this module existed they invented their own line formats independently. The trace wrote
 * `key: value`; the panel wrote `Label: commit · committed … · built …`. Two formats meant a reader
 * receiving both had to parse both, and a fact that lived in one was simply absent from the other:
 * the trace carried the browser and the route and nothing about the fleet, while the panel carried
 * the fleet and nothing about the browser.
 *
 * So the FORMAT lives here and the CONTENT lives with the surface that knows it. Every row is
 * `key: value`. A section is a named group of rows, indented under its own heading. That is the
 * whole grammar, and it is deliberately small: a paste is read by a person under time pressure,
 * and a grammar with two rules stays legible at forty lines.
 *
 * ABSENT FACTS ARE STATED, NEVER DROPPED. `entry()` takes the word to use when a value is missing
 * rather than skipping the row, because "error id: (none issued)" is a finding — it says the failure
 * never reached the platform's error boundary — whereas a missing line is indistinguishable from a
 * paste that got truncated. A caller that genuinely has nothing to say omits the whole SECTION,
 * which reads as "not applicable here" rather than as a gap.
 *
 * PURE, AND FREE OF THE BUILD DEFINES. Nothing here reads a global or a bundler constant, so the
 * node-pool tests exercise the grammar directly — the same trade ./failure-trace.ts already makes.
 */

/** One row: a fact and its name. The only row shape any diagnosis in this app produces. */
export interface ReportEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * A named group of rows.
 *
 * `title` is null for the report's leading block — the facts that need no heading because they are
 * what the whole report is about (which build, which route, when it was copied). A titled section
 * renders its heading and indents its rows beneath it.
 *
 * `notes` are free lines that are not `key: value` at all: a breadcrumb trail, a list of field
 * errors. They indent with the rows and follow them.
 */
export interface ReportSection {
  readonly title: string | null;
  readonly entries: readonly ReportEntry[];
  readonly notes?: readonly string[];
}

/** The word for a fact the source carries a slot for but no value in. */
export const NOT_STATED = "(not stated)";

/** The word for a handle nobody issued — a finding in its own right, never a dropped row. */
export const NONE_ISSUED = "(none issued)";

/** How far a titled section's rows sit in from its heading. */
const INDENT = "  ";

/**
 * One row. `absent` is the word used when the value is null or empty, so a caller states a missing
 * fact rather than deciding to omit it — the omission decision belongs to whoever drops the section.
 */
export function entry(
  key: string,
  value: string | number | boolean | null | undefined,
  absent: string = NOT_STATED,
): ReportEntry {
  if (value === null || value === undefined || value === "") return { key, value: absent };
  return { key, value: typeof value === "string" ? value : String(value) };
}

/** A section, or null when it has nothing at all to say and should not appear. */
export function section(
  title: string | null,
  entries: readonly (ReportEntry | null)[],
  notes: readonly string[] = [],
): ReportSection | null {
  const kept = entries.filter((candidate): candidate is ReportEntry => candidate !== null);
  if (kept.length === 0 && notes.length === 0) return null;
  return { title, entries: kept, notes };
}

/** A section's own lines: its heading if it has one, then its rows and notes, indented if it does. */
export function renderReportSection(reportSection: ReportSection): string[] {
  const lines: string[] = [];
  const indent = reportSection.title === null ? "" : INDENT;
  if (reportSection.title !== null) lines.push(`${reportSection.title}:`);
  for (const row of reportSection.entries) lines.push(`${indent}${row.key}: ${row.value}`);
  for (const note of reportSection.notes ?? []) lines.push(`${indent}${note}`);
  return lines;
}

/**
 * The whole report: a heading, then every section that had something to say. Sections arrive
 * possibly-null so a caller can hand over the full ordered list and let the empty ones fall out
 * here — which is what keeps an assembly readable as the outline of the document it produces.
 */
export function renderDiagnosticReport(
  heading: string,
  sections: readonly (ReportSection | null)[],
): string {
  const lines: string[] = [heading];
  for (const reportSection of sections) {
    if (reportSection === null) continue;
    lines.push(...renderReportSection(reportSection));
  }
  return lines.join("\n");
}
