import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec-purity gate: every token source file is plain DTCG — no vendor extensions, no
// Terrazzo-specific keys — so the source stays portable to any DTCG-conformant tool.
// The allowlist is deliberately tight: it lists only the DTCG keys this source actually
// uses. Adopting a new DTCG key (e.g. `$deprecated`, or a root `$schema`) means widening
// the allowlist DELIBERATELY, in the same commit that introduces it.

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const TOKENS_DIRECTORY = join(PACKAGE_ROOT, "tokens");

/** DTCG dollar-prefixed keys the token source is allowed to use. */
const DTCG_KEY_ALLOWLIST = new Set(["$type", "$value", "$description", "$deprecated"]);

/** Recursively collect every `*.json` file under a directory, as paths relative to it. */
function collectJsonFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".json"))
    .sort();
}

/**
 * Walk a parsed JSON tree and return every offending dollar-prefixed key:
 * `$extensions` anywhere, or any `$`-key outside the DTCG allowlist.
 */
function findForbiddenDollarKeys(node: unknown, path = ""): string[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => findForbiddenDollarKeys(item, `${path}[${index}]`));
  }
  const offenders: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const keyPath = path === "" ? key : `${path}.${key}`;
    if (key.startsWith("$") && !DTCG_KEY_ALLOWLIST.has(key)) offenders.push(keyPath);
    offenders.push(...findForbiddenDollarKeys(value, keyPath));
  }
  return offenders;
}

/** Walk a parsed JSON tree and return the path of every key with the given name. */
function findKeyNamed(node: unknown, keyName: string, path = ""): string[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => findKeyNamed(item, keyName, `${path}[${index}]`));
  }
  const hits: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const keyPath = path === "" ? key : `${path}.${key}`;
    if (key === keyName) hits.push(keyPath);
    hits.push(...findKeyNamed(value, keyName, keyPath));
  }
  return hits;
}

describe("the purity walkers themselves catch violations (self-check)", () => {
  it("flags $extensions and unknown $-keys, at any depth", () => {
    const crafted = {
      group: {
        token: {
          $type: "color",
          $value: "{color.brand.600}",
          $extensions: { vendor: true },
        },
        $tzPrivate: 1,
      },
    };
    expect(findForbiddenDollarKeys(crafted)).toEqual([
      "group.token.$extensions",
      "group.$tzPrivate",
    ]);
    expect(findKeyNamed(crafted, "$extensions")).toEqual(["group.token.$extensions"]);
  });

  it("accepts a clean DTCG token", () => {
    const clean = { group: { $description: "x", token: { $type: "color", $value: "#fff" } } };
    expect(findForbiddenDollarKeys(clean)).toEqual([]);
  });
});

describe("token source purity (tokens/**/*.json)", () => {
  const tokenFiles = collectJsonFiles(TOKENS_DIRECTORY);

  it("finds the expected token source files", () => {
    // Guards the glob itself: an empty sweep would vacuously pass every assertion below.
    expect(tokenFiles).toContain("semantic.json");
    expect(tokenFiles).toContain(join("modes", "dark.json"));
    expect(tokenFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(tokenFiles)("%s parses as JSON and uses only allowlisted DTCG $-keys", (file) => {
    const parsed: unknown = JSON.parse(readFileSync(join(TOKENS_DIRECTORY, file), "utf8"));
    expect(findKeyNamed(parsed, "$extensions")).toEqual([]);
    expect(findForbiddenDollarKeys(parsed)).toEqual([]);
  });
});

describe("resolver.json purity", () => {
  const resolver = JSON.parse(readFileSync(join(PACKAGE_ROOT, "resolver.json"), "utf8")) as Record<
    string,
    unknown
  >;

  it("contains no Terrazzo-specific keys (tzMode) anywhere", () => {
    expect(findKeyNamed(resolver, "tzMode")).toEqual([]);
  });

  it("uses only documented top-level DTCG resolver keys", () => {
    expect(Object.keys(resolver).sort()).toEqual(
      ["description", "modifiers", "name", "resolutionOrder", "sets", "version"].sort(),
    );
  });

  it("each set uses only documented keys, with $ref-only sources", () => {
    const sets = resolver["sets"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(sets).length).toBeGreaterThan(0);
    for (const [setName, set] of Object.entries(sets)) {
      for (const key of Object.keys(set)) {
        expect(["description", "sources"], `sets.${setName}.${key}`).toContain(key);
      }
      for (const source of set["sources"] as Record<string, unknown>[]) {
        expect(Object.keys(source), `sets.${setName}.sources`).toEqual(["$ref"]);
      }
    }
  });

  it("each modifier uses only documented keys, with $ref-only context entries", () => {
    const modifiers = resolver["modifiers"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(modifiers).length).toBeGreaterThan(0);
    for (const [modifierName, modifier] of Object.entries(modifiers)) {
      for (const key of Object.keys(modifier)) {
        expect(
          ["description", "contexts", "default"],
          `modifiers.${modifierName}.${key}`,
        ).toContain(key);
      }
      const contexts = modifier["contexts"] as Record<string, Record<string, unknown>[]>;
      for (const [contextName, contextSources] of Object.entries(contexts)) {
        for (const source of contextSources) {
          expect(Object.keys(source), `modifiers.${modifierName}.contexts.${contextName}`).toEqual([
            "$ref",
          ]);
        }
      }
      // The default context must be one of the declared contexts.
      expect(Object.keys(contexts)).toContain(modifier["default"]);
    }
  });

  it("resolutionOrder is a list of $ref pointers", () => {
    const resolutionOrder = resolver["resolutionOrder"] as Record<string, unknown>[];
    expect(resolutionOrder.length).toBeGreaterThan(0);
    for (const entry of resolutionOrder) {
      expect(Object.keys(entry)).toEqual(["$ref"]);
    }
  });
});
