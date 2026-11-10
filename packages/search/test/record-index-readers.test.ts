// @repo-wide-fitness — scans packages/matter-search/src and packages/conflicts/src for the record
// index sources each one reads. A diff in either package can break it without touching this one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordIndexSources, type RecordIndexReader } from "../src/record-index-sources.ts";

// Each source declares who reads it (`readBy`), and a firm is shown that list on the screen that
// says what is searchable. A declaration nobody checks becomes a sentence on a settings page that
// stopped being true the day a reader was added or removed, so this compares it with the code: the
// source keys each reader's own statements name when they compose the index in.

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

// Where each reader's statements live.
const READER_SOURCE_DIRECTORIES: Record<RecordIndexReader, string> = {
  "matter-search": join(repositoryRoot, "packages", "matter-search", "src"),
  "conflicts-check": join(repositoryRoot, "packages", "conflicts", "src"),
};

// The ways a consumer composes the index into a statement of its own, each naming its source as a
// literal: the three forms record-index-query.ts offers, and the three helpers a matter's search
// wraps them in (packages/matter-search/src/sources/build.ts), which take the request first.
const COMPOSED_SOURCE_KEY =
  /\b(?:recordIndexLeadingMatch|recordIndexMatch|recordIndexNewestMatch)\(\s*\w+,\s*"([a-z-]+)"|\b(?:recordIndexLeadingFrom|recordIdsMatchingSubquery|recordIndexNewestMatchesFrom)\(\s*"([a-z-]+)"/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

function sourceKeysReadIn(directory: string): string[] {
  const keys = new Set<string>();
  for (const file of sourceFiles(directory)) {
    for (const match of readFileSync(file, "utf8").matchAll(COMPOSED_SOURCE_KEY)) {
      const key = match[1] ?? match[2];
      if (key !== undefined) keys.add(key);
    }
  }
  return [...keys].toSorted();
}

describe("who reads each searchable place", () => {
  for (const reader of Object.keys(READER_SOURCE_DIRECTORIES) as RecordIndexReader[]) {
    it(`declares for ${reader} exactly the sources its statements name`, () => {
      const declared = recordIndexSources
        .filter((source) => source.readBy.includes(reader))
        .map((source) => source.key)
        .toSorted();
      const read = sourceKeysReadIn(READER_SOURCE_DIRECTORIES[reader]);
      // A scan that finds nothing agrees with a declaration of nothing, and proves nothing.
      expect(read.length).toBeGreaterThan(0);
      expect(declared).toEqual(read);
    });
  }

  it("names no reader twice on one source", () => {
    for (const source of recordIndexSources) {
      expect(new Set(source.readBy).size).toBe(source.readBy.length);
    }
  });
});
