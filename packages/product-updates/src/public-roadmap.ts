import {
  type PublicRoadmapArtifact,
  type PublicRoadmapBand,
  type PublicRoadmapEntry,
  ROADMAP_BANDS,
  SCHEMA_VERSION,
  publicRoadmapArtifactSchema,
} from "./schema.ts";

// The published roadmap document turned into the artifact a renderer reads — the sibling of
// public-changelog.ts, and strict for the same reason. A malformed document fails the build rather
// than producing a shorter artifact, because the failure being guarded is silent omission: a
// mistyped band heading would otherwise drop a whole section of the roadmap out of the published
// page with nothing raised.
//
// Unlike the changelog, this document is not curated after assembly — it is rendered whole from the
// feature ledger by tooling/doc-fragments/roadmap.mjs on every run. That is why the roadmap can
// promise something the changelog cannot: the band beside an entry is true on the day it is read.
//
// The document is not written to disk today: there are no users, so the public rendering has no
// audience, and a document nobody reads is a document nobody keeps honest. This parser is the seam
// that stays ready — it is fully tested against a rendered document held in the tests, and the
// ledger keys behind it are still linted, so nothing has to be rebuilt when the product has readers.

// `## Building Now` — a band. The set is closed and shared with the assembler; see schema.ts.
const BAND_HEADING = /^## (.+)$/;
// `### Trust accounting` — the area heading a band's entries are grouped under.
const GROUP_HEADING = /^### (.+)$/;
// `- **Name** — summary` in a forward-looking band; `- Name` under Completed, where the changelog
// owns the detail.
const DESCRIBED_ENTRY = /^- \*\*(.+?)\*\* — (.+)$/;
const NAMED_ENTRY = /^- (.+)$/;

export class PublicRoadmapParseError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `The public roadmap document is malformed:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
    );
    this.name = "PublicRoadmapParseError";
    this.problems = problems;
  }
}

function isBand(value: string): value is PublicRoadmapBand {
  return (ROADMAP_BANDS as readonly string[]).includes(value);
}

export function parsePublicRoadmap(markdown: string): PublicRoadmapEntry[] {
  const lines = markdown.split("\n");
  const entries: PublicRoadmapEntry[] = [];
  const problems: string[] = [];
  const seenBands = new Set<string>();

  let band: PublicRoadmapBand | null = null;
  let group: string | null = null;

  for (const [index, line] of lines.entries()) {
    const at = index + 1;

    const heading = BAND_HEADING.exec(line);
    if (heading !== null) {
      const name = (heading[1] ?? "").trim();
      group = null;
      if (!isBand(name)) {
        problems.push(
          `line ${at}: "${name}" is not a roadmap band — one of ${ROADMAP_BANDS.join(", ")}`,
        );
        band = null;
        continue;
      }
      if (seenBands.has(name)) {
        problems.push(`line ${at}: a second "${name}" section — one section per band`);
      }
      seenBands.add(name);
      band = name;
      continue;
    }

    const groupHeading = GROUP_HEADING.exec(line);
    if (groupHeading !== null) {
      if (band === null) {
        problems.push(`line ${at}: group "${(groupHeading[1] ?? "").trim()}" sits outside a band`);
      }
      group = (groupHeading[1] ?? "").trim();
      continue;
    }

    if (!line.startsWith("- ")) continue;
    if (band === null || group === null) {
      problems.push(`line ${at}: an entry outside a band and group, which no renderer would show`);
      continue;
    }

    const described = DESCRIBED_ENTRY.exec(line);
    if (described !== null) {
      entries.push({
        band,
        group,
        name: (described[1] ?? "").trim(),
        summary: (described[2] ?? "").trim(),
      });
      continue;
    }
    const named = NAMED_ENTRY.exec(line);
    if (named !== null) {
      entries.push({ band, group, name: (named[1] ?? "").trim(), summary: null });
    }
  }

  if (problems.length > 0) throw new PublicRoadmapParseError(problems);
  return entries;
}

export function buildPublicRoadmapArtifact(
  markdown: string,
  generatedAt: string,
): PublicRoadmapArtifact {
  // Parsed, then re-validated against the published schema. The parse and the contract are separate
  // things, and a reader of the artifact is entitled to the contract having actually been checked.
  //
  // `generatedAt` is the caller's, not the document's: the document deliberately carries no
  // timestamp, because it is a byte-exact function of the ledger and a clock in it would break the
  // gate that keeps it current. When the page was built is the page's fact.
  return publicRoadmapArtifactSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    entries: parsePublicRoadmap(markdown),
  });
}

// The bands in display order with their entries grouped by area, as a renderer wants them. A band
// with no entries is omitted, matching the document.
export function groupIntoBands(artifact: PublicRoadmapArtifact): {
  band: PublicRoadmapBand;
  groups: { group: string; entries: PublicRoadmapEntry[] }[];
}[] {
  const bands: {
    band: PublicRoadmapBand;
    groups: { group: string; entries: PublicRoadmapEntry[] }[];
  }[] = [];
  for (const entry of artifact.entries) {
    let band = bands.find((candidate) => candidate.band === entry.band);
    if (band === undefined) {
      band = { band: entry.band, groups: [] };
      bands.push(band);
    }
    let group = band.groups.find((candidate) => candidate.group === entry.group);
    if (group === undefined) {
      group = { group: entry.group, entries: [] };
      band.groups.push(group);
    }
    group.entries.push(entry);
  }
  bands.sort((left, right) => ROADMAP_BANDS.indexOf(left.band) - ROADMAP_BANDS.indexOf(right.band));
  return bands;
}
