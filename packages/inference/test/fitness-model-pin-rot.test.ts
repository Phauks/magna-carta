import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  PLATFORM_DEFAULT_REASONING_TIER,
  catalogEntryFor,
  embeddingEntry,
  isZdrEligible,
  reasoningModelForTier,
} from "../src/catalog.ts";
import { expiredModelPins, formatModelPinReport } from "../src/model-pin-freshness.ts";
import { resolveReasoningTier } from "../src/reasoning-tier.ts";

// The gate that turns model-pin rot from a thing somebody notices into a thing the build says.
//
// This is the one suite here that reads the real calendar, and that is the point: a pin's correctness is
// a function of the date, so a check frozen at a fixture date would pass forever while the fact it
// asserts quietly stopped being true.

const today = todayInUtc();
const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

// Comments describe what code WILL do; only code does it. Stripping them is what keeps this scan a
// check on facts rather than on prose — the deferred semantic-search module names the Vectorize binding
// twice in comments explaining the adapter that has not been written, and a scan that counted those
// would fire on correct code from the day it was installed.
function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, " ").replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string, extensions: readonly string[]): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (name === "node_modules" || name === "pkg" || name === ".tsbuild" || name === "dist")
      return [];
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? sourceFiles(full, extensions)
      : extensions.some((extension) => name.endsWith(extension))
        ? [full]
        : [];
  });
}

// Every TypeScript source file under any app or package, plus the deploy configuration files — a
// Vectorize binding declared there is as much a step toward an index as code that calls one.
function everySourceFile(): string[] {
  const files: string[] = [];
  for (const root of [join(repositoryRoot, "apps"), join(repositoryRoot, "packages")]) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      for (const file of sourceFiles(join(root, name, "src"), [".ts"])) files.push(file);
      for (const file of sourceFiles(join(root, name), [".jsonc"])) {
        if (file.includes("wrangler")) files.push(file);
      }
    }
  }
  return files;
}

describe("no model pin has expired (fitness)", () => {
  it("the scan reads the real catalog", () => {
    expect(CATALOG.length).toBeGreaterThan(0);
  });

  it("no catalog entry is past a published retirement date or overdue for re-verification", () => {
    // FAILING HERE IS NOT A BROKEN TEST. It means a model this platform is pinned to has reached a date
    // its provider published, or has gone unread long enough that its recorded facts no longer count as
    // verified. The repair is to re-read the provider's reference, record the dates on the entry in
    // src/catalog.ts, and — if the model is genuinely going away — put the replacement choice to the
    // owner, because which model the platform runs is not a decision this test makes.
    const expired = expiredModelPins(today);
    expect(expired, formatModelPinReport(today)).toEqual([]);
  });
});

describe("the embedding pin is open, and stays honest about it (fitness)", () => {
  it("the scan actually reads the tree", () => {
    expect(everySourceFile().length).toBeGreaterThan(100);
  });

  it("the comment stripper removes the deferred module's mentions but the raw file has them", () => {
    // Self-check on the real file the stripper exists for. If this ever inverts, the scan below is
    // measuring something other than what it claims.
    const deferred = readFileSync(
      join(repositoryRoot, "apps", "api-worker", "src", "search", "semantic-search.ts"),
      "utf8",
    );
    expect(deferred).toContain("VECTORIZE");
    expect(stripComments(deferred)).not.toContain("VECTORIZE");
  });

  it("while the pin is open, nothing writes a vector", () => {
    // The mechanism that keeps the embedding choice available on the day it stops being free.
    //
    // Every stored vector is a function of the model that produced it, so once an index exists the pin
    // cannot be moved without re-embedding every corpus. There is no mechanism that makes that cheap and
    // this test does not pretend to be one. What it does is refuse to let the window close by accident:
    // the first code that writes a vector fails this test, and clearing it means setting pinState to
    // "frozen" in src/catalog.ts — a line whose only honest author is whoever has actually decided which
    // model the index is built with.
    if (embeddingEntry().pinState !== "open") return;
    const offenders = everySourceFile().filter((file) =>
      stripComments(readFileSync(file, "utf8")).includes("VECTORIZE"),
    );
    expect(
      offenders.map((file) => file.replaceAll("\\", "/")),
      "the embedding pin still reads open but code now reaches a vector index; decide and record the embedding model (catalog.ts pinState) before the first vector is written",
    ).toEqual([]);
  });

  it("the embedding entry names the index generation its vectors belong to", () => {
    expect(embeddingEntry().indexVersion).toBeTruthy();
    expect(embeddingEntry().snapshotId).toContain(embeddingEntry().indexVersion ?? "");
  });
});

describe("recording a successor does not make it selectable (fitness)", () => {
  it("no model named in supersededBy is ZDR-eligible or resolvable", () => {
    // supersededBy is an observation about the provider's catalogue, not an instruction. A successor has
    // no verified confidentiality facts in this repository, so it must remain unselectable until somebody
    // adds a curated entry for it — which is the step that carries the verification.
    const successors = CATALOG.flatMap((entry) =>
      entry.supersededBy === undefined ? [] : [entry.supersededBy],
    );
    // Empty when every successor the provider has published is already curated, which is the state a
    // verification pass aims for; the loop then has nothing to refuse, and that is the right answer.
    for (const successor of successors) {
      expect(isZdrEligible(successor), successor).toBe(false);
      expect(catalogEntryFor(successor), successor).toBeUndefined();
      // Also unreachable through the gateway-prefixed form a caller would plausibly try.
      expect(isZdrEligible(`anthropic/${successor}`), successor).toBe(false);
    }
  });

  it("tier resolution ignores supersededBy entirely", () => {
    // Resolution reads the tier field alone; a successor observation on any entry never redirects it.
    const occupant = reasoningModelForTier(PLATFORM_DEFAULT_REASONING_TIER);
    expect(resolveReasoningTier(PLATFORM_DEFAULT_REASONING_TIER).entry.modelId).toBe(
      occupant.modelId,
    );
  });
});

describe("today's behaviour is exactly yesterday's (fitness)", () => {
  it("the default tier still resolves to the model the platform already ran", () => {
    // The tier indirection is a mechanism, not a migration. If this ever fails as a side effect of a
    // refactor, a firm's model changed without anybody deciding it should. The value moved from
    // claude-opus-4-8 to claude-opus-5-5 by the owner's decision of 2026-11-09; the next move is the
    // owner's to make too.
    expect(reasoningModelForTier(PLATFORM_DEFAULT_REASONING_TIER).modelId).toBe(
      "anthropic/claude-opus-5-5",
    );
  });

  it("the embedding model is unchanged", () => {
    expect(embeddingEntry().modelId).toBe("@cf/baai/bge-large-en-v1.5");
  });
});
