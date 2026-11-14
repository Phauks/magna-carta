/*
 * What the Metadata tab draws from a metadata report, and the scrub it asks for.
 *
 * The engine (`@magna-carta/metadata`) reports findings by category, and strips by a smaller set of
 * switches: one switch can cover several categories (the author fields, the page-one preview and the
 * editing-session identifiers all go with "identifying metadata"). The tab draws one table per
 * switch, so every box the reader ticks is exactly one thing the engine can honour, and nothing on
 * screen promises a finer cut than the scrub makes.
 */
import type { Finding, FindingCategory, MetadataReport, ScrubOptions } from "@magna-carta/metadata";

export type ScrubSwitch = keyof ScrubOptions;

export interface FindingGroup {
  readonly switch: ScrubSwitch;
  readonly title: string;
  readonly findings: readonly Finding[];
}

/** The tables in the order they are drawn: what a reader would least want sent goes first. */
const GROUPS: readonly {
  readonly switch: ScrubSwitch;
  readonly title: string;
  readonly categories: readonly FindingCategory[];
}[] = [
  { switch: "trackedChanges", title: "Tracked Changes", categories: ["tracked-changes"] },
  { switch: "comments", title: "Comments", categories: ["comments"] },
  { switch: "hiddenContent", title: "Hidden Text", categories: ["hidden-content"] },
  {
    switch: "identifyingMetadata",
    title: "Document Properties",
    categories: ["identifying-metadata", "embedded-preview", "edit-history", "document-settings"],
  },
  {
    switch: "customProperties",
    title: "Custom Data",
    categories: ["custom-properties", "embedded-data"],
  },
  {
    switch: "imageMetadata",
    title: "Picture Metadata",
    categories: ["image-location", "image-software", "image-other", "image-trailing-data"],
  },
];

/** The report's findings, grouped by the switch that strips them. Empty groups are left out. */
export function groupsOf(report: MetadataReport): FindingGroup[] {
  const groups: FindingGroup[] = [];
  for (const group of GROUPS) {
    const findings = report.findings.filter((finding) =>
      group.categories.includes(finding.category),
    );
    if (findings.length > 0) groups.push({ switch: group.switch, title: group.title, findings });
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
