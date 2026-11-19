/*
 * What the Metadata tab draws from a metadata report, and the scrub it asks for.
 *
 * The engine (`@magna-carta/metadata`) reports findings by category, and strips by a smaller set of
 * switches: one switch can cover several categories (the author fields, the page-one preview and the
 * editing-session identifiers all go with "identifying metadata"). The tab draws one table per
 * switch, so every box the reader ticks is exactly one thing the engine can honour, and nothing on
 * screen promises a finer cut than the scrub makes.
 *
 * Each table lists the values the engine read: a property and what it says, who changed or
 * commented on what and when. A finding with no readable value (a preview picture, editing-session
 * identifiers) is a row with its count instead.
 */
import {
  formatDate,
  formatDuration,
  formatInstant,
  formatWallClockTime,
  instantAttribute,
} from "@magna-carta/design-system/formatters";
import type {
  DocumentPart,
  FieldMoment,
  FieldValue,
  Finding,
  FindingCategory,
  FindingField,
  MetadataReport,
  RevisionKind,
  ScrubOptions,
} from "@magna-carta/metadata";

export type ScrubSwitch = keyof ScrubOptions;

/** One cell of a findings table. */
export interface TableCell {
  readonly text: string;
  /** A stand-in for a value the file does not record, drawn quieter than a real value. */
  readonly muted?: boolean;
  /** The UTC instant, for a `<time datetime>` around a moment. */
  readonly datetime?: string;
  /** A short line under the value. */
  readonly note?: string;
}

export interface TableRow {
  readonly key: string;
  readonly cells: readonly TableCell[];
}

export interface FindingGroup {
  readonly switch: ScrubSwitch;
  readonly title: string;
  readonly columns: readonly string[];
  readonly findings: readonly Finding[];
  readonly rows: readonly TableRow[];
}

export type RowShape = "property" | "revision" | "comment" | "hidden";

/** The tables in the order they are drawn: what a reader would least want sent goes first. */
const GROUPS: readonly {
  readonly switch: ScrubSwitch;
  readonly title: string;
  readonly columns: readonly string[];
  readonly shape: RowShape;
  readonly categories: readonly FindingCategory[];
}[] = [
  {
    switch: "trackedChanges",
    title: "Tracked Changes",
    columns: ["Author", "Change", "When"],
    shape: "revision",
    categories: ["tracked-changes"],
  },
  {
    switch: "comments",
    title: "Comments",
    columns: ["Author", "Comment", "When"],
    shape: "comment",
    categories: ["comments"],
  },
  {
    switch: "hiddenContent",
    title: "Hidden Text",
    columns: ["Where", "Text"],
    shape: "hidden",
    categories: ["hidden-content"],
  },
  {
    switch: "identifyingMetadata",
    title: "Document Properties",
    columns: ["Property", "Value"],
    shape: "property",
    categories: ["identifying-metadata", "embedded-preview", "edit-history", "document-settings"],
  },
  {
    switch: "customProperties",
    title: "Custom Data",
    columns: ["Name", "Value"],
    shape: "property",
    categories: ["custom-properties", "embedded-data"],
  },
  {
    switch: "imageMetadata",
    title: "Picture Metadata",
    columns: ["Field", "Value"],
    shape: "property",
    categories: ["image-location", "image-software", "image-other", "image-trailing-data"],
  },
];

/** What a finding is called on a row of its own, where it has no values to list. */
const FINDING_NAMES: Readonly<Record<FindingCategory, string>> = {
  "identifying-metadata": "Document properties",
  "tracked-changes": "Tracked changes",
  comments: "Comments",
  "hidden-content": "Hidden passages",
  "custom-properties": "Custom properties",
  "edit-history": "Editing marks",
  "document-settings": "Stored settings",
  "embedded-preview": "Page preview",
  "embedded-data": "Stored data",
  "image-location": "Camera data",
  "image-software": "Editing software data",
  "image-other": "Other metadata",
  "image-trailing-data": "Data after the picture",
};

const PART_NAMES: Readonly<Record<DocumentPart, string>> = {
  body: "Body",
  header: "Header",
  footer: "Footer",
  footnotes: "Footnotes",
  endnotes: "Endnotes",
};

const REVISION_VERBS: Readonly<Record<Exclude<RevisionKind, "formatted">, string>> = {
  inserted: "Inserted",
  deleted: "Deleted",
  moved: "Moved",
};

const NOT_RECORDED: TableCell = { text: "Not recorded", muted: true };

/** A moment as the reader sees it: an instant in their own zone, a zoneless one as written. */
function momentCell(moment: FieldMoment): TableCell {
  if (moment.form === "instant") {
    const datetime = instantAttribute(moment.instant);
    return datetime === undefined
      ? { text: formatInstant(moment.instant) }
      : { text: formatInstant(moment.instant), datetime };
  }
  const day = formatDate(moment.date);
  const text = moment.time === undefined ? day : `${day}, ${formatWallClockTime(moment.time)}`;
  return { text, note: "No time zone recorded" };
}

/** A field's value as one cell. */
export function valueCell(value: FieldValue): TableCell {
  if (value.form === "text")
    return value.text === "" ? { text: "No text", muted: true } : { text: value.text };
  if (value.form === "minutes") return { text: formatDuration(value.minutes).text };
  return momentCell(value);
}

function nameCell(name: string): TableCell {
  return name === "" ? NOT_RECORDED : { text: name };
}

function revisionCell(field: FindingField): TableCell {
  if (field.revision === undefined || field.revision === "formatted") {
    return { text: "Changed formatting" };
  }
  const words = field.value.form === "text" ? field.value.text : valueCell(field.value).text;
  return { text: `${REVISION_VERBS[field.revision]} "${words}"` };
}

function fieldCells(field: FindingField, shape: RowShape): TableCell[] {
  const when = field.when === undefined ? NOT_RECORDED : momentCell(field.when);
  if (shape === "revision") return [nameCell(field.name), revisionCell(field), when];
  if (shape === "comment") return [nameCell(field.name), valueCell(field.value), when];
  if (shape === "hidden") {
    return [
      field.part === undefined ? NOT_RECORDED : { text: PART_NAMES[field.part] },
      valueCell(field.value),
    ];
  }
  return [nameCell(field.name), valueCell(field.value)];
}

// Pad a row to the table's width, so a short row in a three-column table still has its edges.
function padded(cells: TableCell[], width: number): TableCell[] {
  while (cells.length < width) cells.push({ text: "" });
  return cells;
}

/** The rows a finding contributes: its values, or one row with its count where it has none. */
export function rowsOf(finding: Finding, shape: RowShape, width: number): TableRow[] {
  const fields = finding.fields ?? [];
  if (fields.length === 0) {
    return [
      {
        key: `${finding.category}-count`,
        cells: padded(
          [{ text: FINDING_NAMES[finding.category] }, { text: String(finding.count) }],
          width,
        ),
      },
    ];
  }
  const rows: TableRow[] = fields.map((field, index) => ({
    key: `${finding.category}-${index}`,
    cells: padded(fieldCells(field, shape), width),
  }));
  const unlisted = finding.unlistedFieldCount ?? 0;
  if (unlisted > 0) {
    rows.push({
      key: `${finding.category}-unlisted`,
      cells: padded([{ text: "" }, { text: `${unlisted} more not listed`, muted: true }], width),
    });
  }
  return rows;
}

/** The report's findings, grouped by the switch that strips them. Empty groups are left out. */
export function groupsOf(report: MetadataReport): FindingGroup[] {
  const groups: FindingGroup[] = [];
  for (const group of GROUPS) {
    const findings = report.findings.filter((finding) =>
      group.categories.includes(finding.category),
    );
    if (findings.length === 0) continue;
    // Categories are drawn in the group's own order, so the author comes before the preview.
    const ordered = findings.toSorted(
      (a, b) => group.categories.indexOf(a.category) - group.categories.indexOf(b.category),
    );
    groups.push({
      switch: group.switch,
      title: group.title,
      columns: group.columns,
      findings,
      rows: ordered.flatMap((finding) => rowsOf(finding, group.shape, group.columns.length)),
    });
  }
  return groups;
}

/** The scrub options for the ticked switches. Anything not ticked is kept. */
export function optionsFrom(ticked: ReadonlySet<ScrubSwitch>): ScrubOptions {
  return {
    identifyingMetadata: ticked.has("identifyingMetadata"),
    trackedChanges: ticked.has("trackedChanges"),
    comments: ticked.has("comments"),
    hiddenContent: ticked.has("hiddenContent"),
    customProperties: ticked.has("customProperties"),
    imageMetadata: ticked.has("imageMetadata"),
  };
}

/**
 * The findings a clean copy still carries that the reader asked to have removed. Anything here is a
 * scrub that did not do what it was told, which the tab must say rather than call the copy clean.
 */
export function leftBehind(output: MetadataReport, ticked: ReadonlySet<ScrubSwitch>): Finding[] {
  return groupsOf(output)
    .filter((group) => ticked.has(group.switch))
    .flatMap((group) => group.findings);
}

/** "Engagement Letter.docx" becomes "Engagement Letter (clean).docx". */
export function cleanCopyName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name} (clean)`;
  return `${name.slice(0, dot)} (clean)${name.slice(dot)}`;
}
