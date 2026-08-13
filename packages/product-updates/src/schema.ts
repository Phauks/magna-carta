import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

// The Keep-a-Changelog categories, in the order a rendered section presents them. Shared with the
// fragment assembler in tooling/doc-fragments/changelog.mjs, which folds entries under these exact
// headings; the two lists are asserted equal by this package's tests rather than merely intended to
// match, because a heading the assembler writes and this parser does not know would be dropped from
// the artifact without failing anything.
export const CHANGELOG_CATEGORIES = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
] as const;

export const changelogCategorySchema = z.enum(CHANGELOG_CATEGORIES);

// Entries publish DATED rather than versioned: the product ships continuously and no release has
// been cut, so a version list would have to be invented. `version` is carried anyway and stays null
// until releases begin — at which point a renderer groups by it instead of by date with nothing in
// this shape reworked. It is present-and-null rather than absent because adding a field to a
// published artifact schema is a change every reader has to tolerate, and this one is foreseeable.
export const publicChangelogEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  version: z.string().nullable(),
  category: changelogCategorySchema,
  text: z.string().min(1),
});

export const publicChangelogArtifactSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  // Reverse-chronological, newest first, matching the order the assembled document holds them in.
  entries: z.array(publicChangelogEntrySchema),
});

// The roadmap's horizon bands, in the order a rendered page presents them. Shared with the ledger
// renderer in tooling/doc-fragments/roadmap.mjs, which writes these exact headings; the two lists
// are asserted equal by this package's tests rather than merely intended to match, for the same
// reason as the categories above — a band the renderer writes and this parser does not know would
// be dropped from the artifact without failing anything.
//
// They are the community board's own status names, so a request card and a roadmap entry never say
// the same thing in two vocabularies. `Beta` is the board's sixth and is deliberately absent: no
// ledger status can honestly produce it until the release-channel work defines what beta means.
//
// There is no date, target, or confidence field here, and its absence is the design rather than an
// omission. A nullable one gets populated, and then it is a promise.
export const ROADMAP_BANDS = [
  "Building Now",
  "Planned",
  "Future",
  "Completed",
  "Not on the roadmap",
] as const;

export const roadmapBandSchema = z.enum(ROADMAP_BANDS);

export const publicRoadmapEntrySchema = z.object({
  band: roadmapBandSchema,
  // The area heading the entry sits under, as the document names it for a reader.
  group: z.string().min(1),
  name: z.string().min(1),
  // Null under Completed, where the changelog owns what a shipped capability does and when it
  // arrived; a summary here as well would be a second account of the same fact.
  summary: z.string().min(1).nullable(),
});

export const publicRoadmapArtifactSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  // In document order: bands in display order, areas within a band, entries within an area.
  entries: z.array(publicRoadmapEntrySchema),
});

export type ChangelogCategory = z.infer<typeof changelogCategorySchema>;
export type PublicRoadmapBand = z.infer<typeof roadmapBandSchema>;
export type PublicRoadmapEntry = z.infer<typeof publicRoadmapEntrySchema>;
export type PublicRoadmapArtifact = z.infer<typeof publicRoadmapArtifactSchema>;
export type PublicChangelogEntry = z.infer<typeof publicChangelogEntrySchema>;
export type PublicChangelogArtifact = z.infer<typeof publicChangelogArtifactSchema>;

// One dated group as a renderer wants it: the date, its optional version, and the entries under it
// grouped by category in display order.
export type PublicChangelogRelease = {
  date: string;
  version: string | null;
  categories: { category: ChangelogCategory; entries: PublicChangelogEntry[] }[];
};

export function groupIntoReleases(artifact: PublicChangelogArtifact): PublicChangelogRelease[] {
  const releases: PublicChangelogRelease[] = [];
  for (const entry of artifact.entries) {
    let release = releases.at(-1);
    if (release === undefined || release.date !== entry.date) {
      release = { date: entry.date, version: entry.version, categories: [] };
      releases.push(release);
    }
    let group = release.categories.find((candidate) => candidate.category === entry.category);
    if (group === undefined) {
      group = { category: entry.category, entries: [] };
      release.categories.push(group);
    }
    group.entries.push(entry);
  }
  for (const release of releases) {
    release.categories.sort(
      (left, right) =>
        CHANGELOG_CATEGORIES.indexOf(left.category) - CHANGELOG_CATEGORIES.indexOf(right.category),
    );
  }
  return releases;
}
