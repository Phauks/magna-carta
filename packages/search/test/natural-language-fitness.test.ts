// @repo-wide-fitness — scans apps/*/src and packages/*/src for generation calls, public-endpoint
// enablement, caller-shaped filter inputs, and a second spelling of the managed index's metadata
// schema. Any package's diff can break it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES,
  NATURAL_LANGUAGE_FEED_OBJECT_CLASS,
  NATURAL_LANGUAGE_RESERVED_OBJECT_CLASSES,
  naturalLanguageFeedObjectDimensions,
} from "../src/natural-language-feed.ts";
import { NATURAL_LANGUAGE_METADATA_FIELDS } from "../src/natural-language-instance.ts";

// The fitness functions for the managed natural-language search surface. Each one is a claim the
// design makes that a future edit could quietly break, expressed as a scan over the real tree rather
// than as a rule somebody has to remember at review time.
//
// FOUR CLAIMS:
//   1. Nothing anywhere constructs a generation call. The surface returns passages a firm's own
//      lawyers wrote; nothing composes prose, and that is a position rather than a phase.
//   2. Nothing anywhere enables a public endpoint on an instance. They are unauthenticated by
//      default on a hostname that is never rotated.
//   3. The feed writer emits exactly one object class and cannot emit a reserved one.
//   4. The instance configuration constant is the ONLY source of the metadata schema, because
//      changing that schema re-indexes every document in every firm's instance.

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

// Comments describe what code WILL do; only code does it. Stripping them is what keeps these scans
// checks on facts rather than on prose — this very file, and the design commentary in the modules it
// scans, name every forbidden token while doing none of them.
function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, " ").replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(directory: string): string[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (name === "node_modules" || name === "pkg" || name === ".tsbuild" || name === "dist") {
      return [];
    }
    const full = join(directory, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : name.endsWith(".ts") ? [full] : [];
  });
}

function everySourceFile(): string[] {
  const files: string[] = [];
  for (const root of [join(repositoryRoot, "apps"), join(repositoryRoot, "packages")]) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) files.push(...sourceFiles(join(root, name, "src")));
  }
  return files;
}

function offenders(pattern: RegExp): string[] {
  return everySourceFile()
    .filter((file) => pattern.test(stripComments(readFileSync(file, "utf8"))))
    .map((file) => file.slice(repositoryRoot.length + 1).replaceAll("\\", "/"));
}

describe("the scans read the real tree", () => {
  it("finds a source tree worth scanning", () => {
    // A scan that matches nothing exits green having proved nothing. This is the self-check that
    // the other four assertions are measuring something.
    expect(everySourceFile().length).toBeGreaterThan(100);
  });

  it("the comment stripper removes prose while leaving code", () => {
    // Self-check on a real file the stripper exists for. The port module's commentary names the
    // reserved metadata field `confidentiality_scope` while its code declares no such thing, so a
    // scan that counted comments would fire on correct code.
    const instance = readFileSync(
      join(repositoryRoot, "packages", "search", "src", "natural-language-instance.ts"),
      "utf8",
    );
    expect(instance).toContain("re-indexes every firm");
    expect(stripComments(instance)).not.toContain("re-indexes every firm");
    expect(stripComments(instance)).toContain("NATURAL_LANGUAGE_METADATA_FIELDS");
  });
});

describe("no generation, anywhere (fitness)", () => {
  it("no source file constructs a generation call", () => {
    // FAILING HERE IS NOT A BROKEN TEST. It means something in this platform has started asking a
    // model to compose text over a retrieval index, which relocates the verification burden onto a
    // reader who cannot see what was not retrieved. Generation over privileged content is a separate
    // design behind a consent decision that has not been made; it is not a setting and not a
    // refactor.
    expect(offenders(/\bchatCompletions\b/)).toEqual([]);
  });

  it("no source file configures a text-generation model on an instance", () => {
    expect(offenders(/\b(?:generation_model|generationModel|text_generation_model)\b/)).toEqual([]);
  });
});

describe("no public endpoint, anywhere (fitness)", () => {
  it("no source file enables one", () => {
    // The three of them are unauthenticated by default on a hostname that is never rotated. Every
    // query goes through this platform's own authenticated API, where the caller's entitlement to
    // the matter has already been checked before a query is built.
    expect(offenders(/\bpublic_?[eE]ndpoints?\s*[:=]\s*(?:true|1|\[)/)).toEqual([]);
    expect(offenders(/\benable_?[pP]ublic_?[eE]ndpoint\b/)).toEqual([]);
  });

  it("no source file reaches the managed index over its model-context protocol surface", () => {
    // It is only available through a public endpoint, so it is refused for the same reason.
    expect(offenders(/\bai_?[sS]earch[^\n]{0,40}\/mcp\b/)).toEqual([]);
  });
});

describe("the feed writer's object classes (fitness)", () => {
  it("emits exactly one class", () => {
    // The allow-list with one entry is what makes the exclusion of transcripts, work product, and an
    // opposing party's production structural rather than a filter. A second entry here means
    // somebody has widened what can reach the managed index, which is the change that most needs to
    // be deliberate.
    expect([...NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES]).toHaveLength(1);
    expect(NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES[0]).toBe(
      NATURAL_LANGUAGE_FEED_OBJECT_CLASS,
    );
  });

  it("cannot emit a reserved class", () => {
    for (const reserved of NATURAL_LANGUAGE_RESERVED_OBJECT_CLASSES) {
      expect(NATURAL_LANGUAGE_FEED_EMITTED_OBJECT_CLASSES).not.toContain(reserved);
    }
    // And the stamp a fed object actually carries is the working-document literal, not whatever a
    // caller passed: the dimension builder takes a matter and nothing else, so a reserved class has
    // no argument through which to arrive.
    const stamped = naturalLanguageFeedObjectDimensions("matter_x" as never);
    expect(stamped.object_class).toBe(NATURAL_LANGUAGE_FEED_OBJECT_CLASS);
    expect(NATURAL_LANGUAGE_RESERVED_OBJECT_CLASSES).not.toContain(stamped.object_class);
  });
});

describe("the metadata schema has one source (fitness)", () => {
  it("no source file outside the configuration constant spells the field list out again", () => {
    // Changing an instance's metadata schema re-indexes every document in it, for every firm at
    // once. That makes the field list a foundation rather than a setting, and a second literal
    // spelling of it anywhere is a second place it can drift from what the instances were actually
    // created with — a drift whose symptom is a filter that matches nothing while looking like it
    // works.
    //
    // The scan looks for the four names appearing together in one file, which is what a second
    // declaration looks like and what an ordinary use of one field does not.
    const together = new RegExp(
      NATURAL_LANGUAGE_METADATA_FIELDS.map((field) => `["']${field}["']`).join("[\\s\\S]{0,200}"),
    );
    expect(
      offenders(together).filter(
        (file) => !file.endsWith("packages/search/src/natural-language-instance.ts"),
      ),
    ).toEqual([]);
  });

  it("the constant itself is what the scan exempts, so the exemption is not vacuous", () => {
    // If the declaration ever moves out of that file, the exemption above stops naming anything and
    // this assertion is what says so.
    const declaration = readFileSync(
      join(repositoryRoot, "packages", "search", "src", "natural-language-instance.ts"),
      "utf8",
    );
    for (const field of NATURAL_LANGUAGE_METADATA_FIELDS) {
      expect(stripComments(declaration)).toContain(`"${field}"`);
    }
  });
});

describe("no filter value can come from a caller (fitness)", () => {
  it("the port's input has no filter field", () => {
    // The metadata filter is derived server-side from the authenticated session and the route's own
    // path parameters, every time. A request body field that reached a filter would be the whole
    // vulnerability, so the input type has no slot for one — this asserts on the declared type text
    // rather than on a value, because the property being defended is that the slot does not exist.
    const port = stripComments(
      readFileSync(
        join(repositoryRoot, "packages", "search", "src", "natural-language-port.ts"),
        "utf8",
      ),
    );
    const inputBlock = port.slice(
      port.indexOf("export interface NaturalLanguageSearchInput"),
      port.indexOf("export interface NaturalLanguagePassage"),
    );
    expect(inputBlock.length).toBeGreaterThan(0);
    for (const forbidden of ["filter", "metadata", "objectKey", "instance"]) {
      expect(inputBlock.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("the object-class include list is a closed literal union, not a string", () => {
    const port = stripComments(
      readFileSync(
        join(repositoryRoot, "packages", "search", "src", "natural-language-port.ts"),
        "utf8",
      ),
    );
    // A `readonly string[]` here would let any value a request body carried become a filter
    // argument. The literal union is what makes that unrepresentable.
    expect(port).toContain('readonly objectClasses: readonly "working-document"[];');
  });
});
