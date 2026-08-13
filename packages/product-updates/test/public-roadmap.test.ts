import { describe, expect, it } from "vitest";
import {
  PublicRoadmapParseError,
  buildPublicRoadmapArtifact,
  groupIntoBands,
  parsePublicRoadmap,
} from "../src/public-roadmap.ts";

const document = [
  "# Magna Carta roadmap",
  "",
  "Preamble prose the parser deliberately ignores.",
  "",
  "## Building Now",
  "",
  "Being worked on right now.",
  "",
  "### Trust accounting",
  "",
  "- **Trust reconciliation** — Reconcile the trust account against the bank.",
  "",
  "### Billing",
  "",
  "- **Invoice delivery** — Send a bill to a client and see when it was opened.",
  "",
  "## Completed",
  "",
  "Delivered and in use.",
  "",
  "### Trust accounting",
  "",
  "- Client trust ledger",
  "",
].join("\n");

describe("parsePublicRoadmap", () => {
  it("reads every entry with its band and group", () => {
    expect(parsePublicRoadmap(document)).toEqual([
      {
        band: "Building Now",
        group: "Trust accounting",
        name: "Trust reconciliation",
        summary: "Reconcile the trust account against the bank.",
      },
      {
        band: "Building Now",
        group: "Billing",
        name: "Invoice delivery",
        summary: "Send a bill to a client and see when it was opened.",
      },
      {
        band: "Completed",
        group: "Trust accounting",
        name: "Client trust ledger",
        summary: null,
      },
    ]);
  });

  it("refuses a band heading it does not know, rather than dropping the section", () => {
    const broken = document.replace("## Building Now", "## Building now");
    expect(() => parsePublicRoadmap(broken)).toThrow(PublicRoadmapParseError);
    expect(() => parsePublicRoadmap(broken)).toThrow(/is not a roadmap band/);
  });

  it("refuses an entry that sits outside a band and group", () => {
    expect(() => parsePublicRoadmap("# Title\n\n- **Orphan** — Nowhere to render.\n")).toThrow(
      /outside a band and group/,
    );
  });

  it("refuses a band section stated twice", () => {
    expect(() => parsePublicRoadmap(`${document}\n## Completed\n\n### X\n\n- Y\n`)).toThrow(
      /a second "Completed" section/,
    );
  });

  it("collects every problem rather than stopping at the first", () => {
    try {
      parsePublicRoadmap("# Title\n\n## Soon\n\n### X\n\n- Y\n\n## Later\n\n### X\n\n- Z\n");
      expect.unreachable("the document is malformed");
    } catch (error) {
      const { problems } = error as PublicRoadmapParseError;
      expect(problems.filter((problem) => problem.includes("not a roadmap band"))).toHaveLength(2);
    }
  });
});

describe("buildPublicRoadmapArtifact", () => {
  it("stamps the caller's build time, because the document deliberately carries none", () => {
    const artifact = buildPublicRoadmapArtifact(document, "2026-08-13T00:00:00.000Z");
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.generatedAt).toBe("2026-08-13T00:00:00.000Z");
    expect(artifact.entries).toHaveLength(3);
  });
});

describe("groupIntoBands", () => {
  it("nests entries under their band and group in display order", () => {
    const grouped = groupIntoBands(buildPublicRoadmapArtifact(document, "now"));
    expect(grouped.map((band) => band.band)).toEqual(["Building Now", "Completed"]);
    expect(grouped[0]?.groups.map((group) => group.group)).toEqual(["Trust accounting", "Billing"]);
  });
});
