import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGeneratedCss, parseGeneratedCssText } from "../src/parse-generated-css.ts";

// Theme-completeness gate: every theme-and-mode permutation declared in resolver.json must
// appear as a base selector block in generated/tokens.css, and every semantic token must be
// present in every one of those blocks with a non-empty value. A new theme or mode that misses
// a context, or a semantic token the build dropped, fails here instead of rendering unstyled.
//
// Selector convention (coupled to terrazzo.config.mjs's `permutations`): the default mode emits
// `:root[data-theme="<theme>"]`; every non-default mode appends a class, `.<mode>`. If the
// config's `prepare` convention changes, change `expectedSelector` below in the same commit.

const PACKAGE_ROOT = join(import.meta.dirname, "..");

interface ResolverModifier {
  contexts: Record<string, unknown>;
  default: string;
}

const resolver = JSON.parse(readFileSync(join(PACKAGE_ROOT, "resolver.json"), "utf8")) as {
  modifiers: {
    theme: ResolverModifier;
    mode: ResolverModifier;
    density: ResolverModifier;
    motion: ResolverModifier;
    typeface: ResolverModifier;
  };
};

const themes = Object.keys(resolver.modifiers.theme.contexts);
const modes = Object.keys(resolver.modifiers.mode.contexts);
const defaultMode = resolver.modifiers.mode.default;

function expectedSelector(theme: string, mode: string): string {
  return `:root[data-theme="${theme}"]${mode === defaultMode ? "" : `.${mode}`}`;
}

const expectedSelectors = themes.flatMap((theme) =>
  modes.map((mode) => expectedSelector(theme, mode)),
);

// The motion, density and typeface axes emit one small OVERLAY block per non-default level
// (`:root[data-motion="…"]` / `:root[data-density="…"]`) after the theme x mode matrix — an
// overlay, not a context: each re-points exactly one variable namespace and must carry nothing
// else (a color there would silently override every theme). Default levels are the primitive/
// semantic truth (no block). Each overlay's namespace is pinned below.
function nonDefaultLevels(modifier: ResolverModifier): string[] {
  return Object.keys(modifier.contexts).filter((level) => level !== modifier.default);
}
const overlayExpectations = [
  // Density overlay values stay ALIASED (var() chains onto the primitive scales) — the overlay
  // re-points which primitive each alias reads, it never mints its own lengths.
  ...nonDefaultLevels(resolver.modifiers.density).map((level) => ({
    selector: `:root[data-density="${level}"]`,
    variablePrefix: "--mc-density-",
    minimumVariables: 4,
    valuePattern: /^var\(--mc-(control|space)-[\w-]+\)$/,
  })),
  ...nonDefaultLevels(resolver.modifiers.motion).map((level) => ({
    selector: `:root[data-motion="${level}"]`,
    variablePrefix: "--mc-duration-",
    minimumVariables: 4,
    valuePattern: /^\d+(\.\d+)?m?s$/,
  })),
  // Typeface overlays re-point the reading face alone: one font stack, ending in a generic family
  // so a face that fails to load still falls back to something legible.
  ...nonDefaultLevels(resolver.modifiers.typeface).map((level) => ({
    selector: `:root[data-typeface="${level}"]`,
    variablePrefix: "--mc-font-sans",
    minimumVariables: 1,
    valuePattern: /^.+, (sans-serif|serif)$/,
  })),
];
const expectedOverlaySelectors = overlayExpectations.map(({ selector }) => selector);

/** A token is an object carrying `$value`; names are dot-joined paths, `$`-keys are metadata. */
function collectTokenNames(node: unknown, path = ""): string[] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return [];
  const record = node as Record<string, unknown>;
  if ("$value" in record) return [path];
  const names: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("$")) continue;
    names.push(...collectTokenNames(value, path === "" ? key : `${path}.${key}`));
  }
  return names;
}

const semanticDocument: unknown = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "tokens", "semantic.json"), "utf8"),
);
const semanticTokenNames = collectTokenNames(semanticDocument);

function variableName(tokenName: string): string {
  return `--mc-${tokenName.replaceAll(".", "-")}`;
}

const parsed = parseGeneratedCss();

/** The names whose `--mc-*` variable is absent or empty in a context's variable map. */
function findMissingSemanticVariables(variables: Record<string, string> | undefined): string[] {
  return semanticTokenNames.filter((name) => {
    const value = variables?.[variableName(name)];
    return value === undefined || value.trim() === "";
  });
}

describe("the generated-CSS parser (policy self-check)", () => {
  const crafted = `
/* header comment */
:root[data-theme="example"] {
--mc-a: var(--mc-b);
  --mc-b: oklch(50% 0.1 250);
}

@media (color-gamut: p3) {
  :root[data-theme="example"] {
  --mc-b: oklch(50% 0.12 250);
  }
}

:root[data-theme="example"].dark {
  --mc-a: 4px;
}
`;

  it("collects top-level blocks as base contexts and keeps @media refinements separate", () => {
    const result = parseGeneratedCssText(crafted);
    expect(Object.keys(result.base).sort()).toEqual([
      ':root[data-theme="example"]',
      ':root[data-theme="example"].dark',
    ]);
    expect(result.base[':root[data-theme="example"]']).toEqual({
      "--mc-a": "var(--mc-b)",
      "--mc-b": "oklch(50% 0.1 250)",
    });
    expect(result.base[':root[data-theme="example"].dark']).toEqual({ "--mc-a": "4px" });
    expect(result.media["(color-gamut: p3)"]).toEqual({
      ':root[data-theme="example"]': { "--mc-b": "oklch(50% 0.12 250)" },
    });
  });

  it("rejects CSS it does not understand rather than silently skipping it", () => {
    expect(() => parseGeneratedCssText(":root { color: red }")).toThrow();
  });

  it("rejects two declarations merged onto one line rather than parsing a corrupt value", () => {
    expect(() =>
      parseGeneratedCssText(':root[data-theme="example"] {\n--mc-a: 1px; --mc-b: 2px;\n}\n'),
    ).toThrow(/Unrecognized line/);
  });
});

describe("semantic token collection (self-check + source sanity)", () => {
  it("walks groups and treats $value as the token marker", () => {
    const crafted = {
      $description: "group docs",
      group: { token: { $type: "color", $value: "#fff" }, nested: { deep: { $value: "1px" } } },
    };
    expect(collectTokenNames(crafted).sort()).toEqual(["group.nested.deep", "group.token"]);
  });

  it("finds the semantic tokens (non-empty, includes known names)", () => {
    expect(semanticTokenNames.length).toBeGreaterThanOrEqual(36);
    expect(semanticTokenNames).toContain("surface.default");
    expect(semanticTokenNames).toContain("action.primary-hover");
    expect(semanticTokenNames).toContain("density.control-height");
  });
});

// Mode overlays must be a subset of the semantic token names. A typo'd name in a mode
// overlay generates a stray `--mc-*` variable and leaves the real token un-darkened while
// every other gate stays green: the completeness sweep only checks that semantic names are
// PRESENT (the un-darkened token still inherits the default-mode value), and the stray
// variable is extra, not missing — the one silent half-theming bug the gates didn't catch.
describe("mode overlays are subsets of tokens/semantic.json (tokens/modes/*.json)", () => {
  const MODES_DIRECTORY = join(PACKAGE_ROOT, "tokens", "modes");
  const semanticNameSet = new Set(semanticTokenNames);

  /** The token names in an overlay document that name no semantic token. */
  function findStrayOverlayNames(overlayDocument: unknown): string[] {
    return collectTokenNames(overlayDocument).filter((name) => !semanticNameSet.has(name));
  }

  const modeFiles = readdirSync(MODES_DIRECTORY).filter((entry) => entry.endsWith(".json"));

  it("finds the mode overlay files", () => {
    // Guards the directory listing itself: an empty sweep would vacuously pass below.
    expect(modeFiles).toContain("dark.json");
  });

  it("the stray-name check itself catches a typo'd overlay token (self-check)", () => {
    const crafted = {
      surface: { default: { $type: "color", $value: "#000" } },
      text: { defualt: { $type: "color", $value: "#fff" } }, // typo'd "default"
    };
    expect(findStrayOverlayNames(crafted)).toEqual(["text.defualt"]);
  });

  it.each(modeFiles)("%s names only tokens that exist in semantic.json", (file) => {
    const overlay: unknown = JSON.parse(readFileSync(join(MODES_DIRECTORY, file), "utf8"));
    expect(collectTokenNames(overlay).length).toBeGreaterThan(0);
    expect(findStrayOverlayNames(overlay)).toEqual([]);
  });
});

describe("theme-and-mode completeness (resolver matrix vs generated/tokens.css)", () => {
  it("derives a non-degenerate matrix from resolver.json", () => {
    expect(themes.length).toBeGreaterThanOrEqual(1);
    expect(modes.length).toBeGreaterThanOrEqual(2);
    expect(modes).toContain(defaultMode);
  });

  it("the base context selectors equal exactly the expected matrix plus the axis overlays", () => {
    expect(Object.keys(parsed.base).sort()).toEqual(
      [...expectedSelectors, ...expectedOverlaySelectors].sort(),
    );
  });

  it.each(overlayExpectations)(
    "$selector is a single-namespace overlay ($variablePrefix)",
    ({ selector, variablePrefix, minimumVariables, valuePattern }) => {
      const variables = parsed.base[selector];
      expect(variables).toBeDefined();
      const names = Object.keys(variables ?? {});
      expect(names.length).toBeGreaterThanOrEqual(minimumVariables);
      // Single-namespace: anything else here would silently override every theme x mode context.
      expect(names.filter((name) => !name.startsWith(variablePrefix))).toEqual([]);
      for (const value of Object.values(variables ?? {})) {
        expect(value.trim()).toMatch(valuePattern);
      }
    },
  );

  it("the missing-variable check itself catches absent and empty values (self-check)", () => {
    // Empirical verifier: the gate must actually flag a dropped or emptied variable.
    expect(findMissingSemanticVariables(undefined)).toEqual(semanticTokenNames);
    const firstSelector = expectedSelectors[0] as string;
    const stripped = { ...parsed.base[firstSelector] };
    delete stripped[variableName("text.link")];
    stripped[variableName("surface.default")] = "  ";
    expect(findMissingSemanticVariables(stripped).sort()).toEqual(["surface.default", "text.link"]);
  });

  it.each(expectedSelectors)(
    "%s defines every semantic variable with a non-empty value",
    (selector) => {
      const variables = parsed.base[selector];
      expect(variables).toBeDefined();
      expect(findMissingSemanticVariables(variables)).toEqual([]);
    },
  );
});

describe("tailwind.template.css @theme inline coupling", () => {
  const template = readFileSync(join(PACKAGE_ROOT, "tailwind.template.css"), "utf8");
  const inlineBlockMatch = /@theme inline \{([\s\S]*?)\n\}/.exec(template);

  function parseDeclarations(blockBody: string): Record<string, string> {
    const declarations: Record<string, string> = {};
    const withoutComments = blockBody.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      declarations[match[1] as string] = (match[2] as string).trim();
    }
    return declarations;
  }

  it("the template has an @theme inline block", () => {
    expect(inlineBlockMatch).not.toBeNull();
  });

  const inlineDeclarations = parseDeclarations(inlineBlockMatch?.[1] ?? "");

  // Color-bearing = `$type: "color"` in tokens/semantic.json — derived, not a hand-kept group
  // list, so a new semantic color group is covered automatically.
  const colorTokenNames = semanticTokenNames.filter((name) => {
    let node: unknown = semanticDocument;
    for (const segment of name.split(".")) {
      node = (node as Record<string, unknown>)[segment];
    }
    return (node as Record<string, unknown>)["$type"] === "color";
  });

  /** The color tokens lacking an exact `--color-<dashed>: var(--mc-<dashed>)` mapping. */
  function findUnmappedColorTokens(declarations: Record<string, string>): string[] {
    return colorTokenNames.filter((name) => {
      const dashed = name.replaceAll(".", "-");
      return declarations[`--color-${dashed}`] !== `var(--mc-${dashed})`;
    });
  }

  it("the mapping check itself catches a missing or mistargeted mapping (self-check)", () => {
    // Empirical verifier: a dropped mapping and a wrong var() target must both be flagged.
    expect(findUnmappedColorTokens({})).toEqual(colorTokenNames);
    const mutated = { ...inlineDeclarations };
    delete mutated["--color-status-danger"];
    mutated["--color-text-link"] = "var(--mc-color-brand-600)";
    expect(findUnmappedColorTokens(mutated).sort()).toEqual(["status.danger", "text.link"]);
  });

  it("every color-bearing semantic token has its --color-* mapping onto the --mc-* variable", () => {
    expect(colorTokenNames.length).toBeGreaterThanOrEqual(33);
    expect(findUnmappedColorTokens(inlineDeclarations)).toEqual([]);
  });

  it.each([0, 1, 2, 3])("elevation %i has its --shadow-elevation-* mapping", (level) => {
    expect(inlineDeclarations[`--shadow-elevation-${level}`]).toBe(`var(--mc-elevation-${level})`);
  });

  it("the reading face maps onto the --mc-font-sans variable, so the typeface axis reaches font-sans", () => {
    expect(inlineDeclarations["--font-sans"]).toBe("var(--mc-font-sans)");
  });
});
