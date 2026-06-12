import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectSourceFiles } from "./source-file-sweep.ts";

/*
 * Boundary fitness functions — golden rule 2 ("all UI through the design system"),
 * machine-checked.
 *
 * Rule home: CLAUDE.md golden rule 2; ADR-0076 (component-layer discipline: bits-ui stays
 * behind the design system; Lucide deep imports only; recipes fed exclusively by token
 * custom properties); spec "Catalog, testing & enforcement" item 5
 * (docs/specs/2026-06-10-design-system-foundation-design.md). House pattern: fitness
 * functions are Vitest tests that scan source files (ADR-0051), like the token gates in
 * packages/design-tokens/test/.
 *
 * Three boundaries:
 *   1. bits-ui is imported ONLY inside packages/design-system/src — apps and other packages
 *      consume the styled wrappers, never the headless primitives.
 *   2. @lucide/svelte is imported ONLY in its deep per-icon form
 *      (@lucide/svelte/icons/<name>) — a bare import pulls every icon into the bundle.
 *      Zero Lucide usage exists today; the gate is forward-looking.
 *   3. components.css declarations carry ONLY var(--mc-...) token references and bare
 *      structural keywords — no literal colors, lengths, durations, or numbers.
 *
 * THE SWEEP SURFACE (deliberate; every exclusion justified):
 *   IN  apps/* and packages/* — .ts, .svelte, .js, .mjs — source AND test trees: a banned
 *       import in a test couples that test to the boundary's wrong side just as hard.
 *   OUT node_modules, dist, build, .svelte-kit, storybook-static, generated, coverage —
 *       dependencies and build output, not our sources.
 *   OUT packages/design-system/src — for the bits-ui gate only: it is the one legitimate
 *       home of bits-ui imports. (It stays IN the Lucide sweep — the bare form is banned
 *       even there.)
 *   OUT packages/design-system/test/csp-spike — the CSP probe imports bits-ui DIRECTLY on
 *       purpose: it exercises the primitives' inline-style behavior under a strict CSP
 *       (VERDICT.md), which the styled wrappers would mask.
 *   OUT packages/design-system/test/fitness — this suite's self-checks craft offending
 *       content; scanning ourselves would flag the crafted strings.
 */

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const SOURCE_EXTENSIONS = [".ts", ".svelte", ".js", ".mjs"] as const;

const EXCLUDED_DIRECTORY_NAMES = [
  "node_modules",
  "dist",
  "build",
  ".svelte-kit",
  "storybook-static",
  "generated",
  "coverage",
] as const;

function collectWorkspaceSourceFiles(excludePathPrefixes: readonly string[]): string[] {
  return ["apps", "packages"].flatMap((workspaceRoot) =>
    collectSourceFiles(join(REPOSITORY_ROOT, workspaceRoot), {
      extensions: SOURCE_EXTENSIONS,
      excludeDirectoryNames: EXCLUDED_DIRECTORY_NAMES,
      excludePathPrefixes: excludePathPrefixes
        .filter((prefix) => prefix.startsWith(`${workspaceRoot}/`))
        .map((prefix) => prefix.slice(workspaceRoot.length + 1)),
    }).map((relativePath) => `${workspaceRoot}/${relativePath}`),
  );
}

/** Self-check exclusions shared by both import gates — see the header for why each exists. */
const FITNESS_SELF_EXCLUSIONS = [
  "packages/design-system/test/fitness",
  "packages/design-system/test/csp-spike",
] as const;

// --- gate 1: bits-ui stays inside the design system ----------------------------------------

/**
 * Any string literal naming the bits-ui module specifier (bare or subpath) counts as a
 * reference — deliberately stricter than parsing import statements, so dynamic
 * import("bits-ui"), re-exports, and vite/vitest config aliases are all caught.
 */
const BITS_UI_MODULE_REFERENCE_PATTERN = /["']bits-ui(?:\/[^"']*)?["']/;

export function findBitsUiReferences(filePath: string, content: string): string[] {
  const violations: string[] = [];
  content.split("\n").forEach((line, index) => {
    const hit = BITS_UI_MODULE_REFERENCE_PATTERN.exec(line);
    if (hit) {
      violations.push(
        `${filePath}:${index + 1} [bits-ui-boundary] ${hit[0]} — bits-ui is consumed only ` +
          "inside packages/design-system/src; use the styled wrappers (ADR-0076)",
      );
    }
  });
  return violations;
}

const bitsUiSweep = collectWorkspaceSourceFiles([
  ...FITNESS_SELF_EXCLUSIONS,
  // The one legitimate home of bits-ui imports — excluded from THIS gate only.
  "packages/design-system/src",
]);

describe("bits-ui import boundary (golden rule 2; ADR-0076)", () => {
  it("sweeps a real surface (vacuity guard)", () => {
    expect(bitsUiSweep).toContain("apps/web/src/routes/+page.svelte");
    expect(bitsUiSweep).toContain("apps/worker/src/index.ts");
    expect(bitsUiSweep.length).toBeGreaterThanOrEqual(25);
    // The exclusions must not be vacuous either: the excluded trees really exist and
    // really contain bits-ui references (proven on the real files below).
    expect(bitsUiSweep.some((file) => file.startsWith("packages/design-system/src"))).toBe(false);
    expect(bitsUiSweep.some((file) => file.includes("csp-spike"))).toBe(false);
  });

  it("no swept file references bits-ui", () => {
    const violations = bitsUiSweep.flatMap((file) =>
      findBitsUiReferences(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8")),
    );
    expect(violations).toEqual([]);
  });

  it("the detector finds the real bits-ui imports in the excluded homes (positive control)", () => {
    // Empirical proof the scanner works on real files — and that the exclusions above are
    // load-bearing, not dead configuration.
    const legitimateHome = "packages/design-system/src/lib/internal/types.ts";
    const cspProbe = "packages/design-system/test/csp-spike/App.svelte";
    for (const file of [legitimateHome, cspProbe]) {
      const content = readFileSync(join(REPOSITORY_ROOT, file), "utf8");
      expect(findBitsUiReferences(file, content)).not.toEqual([]);
    }
  });

  it("catches crafted offending imports (self-check)", () => {
    expect(findBitsUiReferences("crafted.ts", 'import { Dialog } from "bits-ui";')).toHaveLength(1);
    expect(findBitsUiReferences("crafted.ts", 'export * from "bits-ui";')).toHaveLength(1);
    expect(findBitsUiReferences("crafted.ts", 'await import("bits-ui");')).toHaveLength(1);
    expect(
      findBitsUiReferences("crafted.ts", "const parts = await import('bits-ui/dist/x');"),
    ).toHaveLength(1);
    // Negative controls: other modules, and prose mentions without a module specifier.
    expect(findBitsUiReferences("crafted.ts", 'import { clsx } from "clsx";')).toEqual([]);
    expect(findBitsUiReferences("crafted.ts", "// background on the bits-ui issue")).toEqual([]);
  });

  it("violation messages carry file, line number, and the offending match (self-check)", () => {
    const violations = findBitsUiReferences("crafted.ts", '\nimport { Dialog } from "bits-ui";');
    expect(violations[0]).toContain("crafted.ts:2");
    expect(violations[0]).toContain('"bits-ui"');
  });
});

// --- gate 2: Lucide deep imports only -------------------------------------------------------

/**
 * The BARE module specifier only — `@lucide/svelte/icons/<name>` (the required deep form,
 * ADR-0076 satellites) does not match because the closing quote must follow immediately.
 */
const BARE_LUCIDE_IMPORT_PATTERN = /["']@lucide\/svelte["']/;

export function findBareLucideImports(filePath: string, content: string): string[] {
  const violations: string[] = [];
  content.split("\n").forEach((line, index) => {
    const hit = BARE_LUCIDE_IMPORT_PATTERN.exec(line);
    if (hit) {
      violations.push(
        `${filePath}:${index + 1} [lucide-deep-import] ${hit[0]} — import icons via ` +
          "@lucide/svelte/icons/<name> (ADR-0076); the bare form bundles every icon",
      );
    }
  });
  return violations;
}

// The Lucide gate sweeps EVERYTHING (including packages/design-system/src — the bare form
// is banned even in the design system); only the fitness/probe self-exclusions apply.
const lucideSweep = collectWorkspaceSourceFiles([...FITNESS_SELF_EXCLUSIONS]);

describe("Lucide deep-import boundary (golden rule 2; ADR-0076)", () => {
  it("sweeps a real surface including the design system itself (vacuity guard)", () => {
    expect(lucideSweep).toContain("packages/design-system/src/lib/internal/floating.ts");
    expect(lucideSweep).toContain("apps/web/src/routes/+page.svelte");
    expect(lucideSweep.length).toBeGreaterThan(bitsUiSweep.length);
  });

  it("no swept file imports @lucide/svelte bare (forward-looking: zero Lucide usage today)", () => {
    const violations = lucideSweep.flatMap((file) =>
      findBareLucideImports(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8")),
    );
    expect(violations).toEqual([]);
  });

  it("catches crafted offending imports and allows the deep form (self-check)", () => {
    expect(
      findBareLucideImports("crafted.ts", 'import { House } from "@lucide/svelte";'),
    ).toHaveLength(1);
    expect(findBareLucideImports("crafted.ts", 'await import("@lucide/svelte");')).toHaveLength(1);
    expect(findBareLucideImports("crafted.ts", "import('@lucide/svelte')")).toHaveLength(1);
    // The required deep form passes.
    expect(
      findBareLucideImports("crafted.ts", 'import House from "@lucide/svelte/icons/house";'),
    ).toEqual([]);
  });
});

// --- gate 3: components.css is fed exclusively by tokens ------------------------------------

/*
 * Every declaration value in packages/design-system/src/lib/styles/components.css must be
 * composed of:
 *   - var(--mc-...) token references, with NO fallback argument (a fallback could smuggle a
 *     literal past the gate), and/or
 *   - bare structural identifiers (solid, flex, pointer, inherit, none, ...) that are not
 *     CSS named colors.
 * Everything else — numbers, lengths, hex, color functions, strings, named colors,
 * !important — is a violation. The file's own header states the same rule; this gate is
 * what makes it bite. The file is an empty @layer today; recipes accrete under this gate.
 * System colors (Canvas, CanvasText, ...) are not special-cased: they fail the named-color
 * check only if added to the list below — widen DELIBERATELY if one is ever needed.
 */

/** CSS named colors (CSS Color Module level 4), lowercase. `transparent` and `currentcolor`
 * are deliberately ABSENT — the components.css header allows them as keywords. */
const CSS_NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen " +
    "linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

const TOKEN_REFERENCE_PATTERN = /^var\(--mc-[a-z0-9-]+\)$/;
const STRUCTURAL_IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z-]*$/;

interface CssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly line: number;
}

/**
 * A deliberately small CSS reader for OUR controlled stylesheet: strips comments
 * (preserving line numbers), then walks braces collecting `property: value` declarations.
 * At-rule preludes and selectors (chunks ending at `{`) and block-less at-rules
 * (@import ...;) are structural, not declarations.
 */
export function extractCssDeclarations(css: string): CssDeclaration[] {
  const withoutComments = css.replace(/\/\*[^]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
  const declarations: CssDeclaration[] = [];
  let braceDepth = 0;
  let buffer = "";
  let bufferStartLine = 1;
  let currentLine = 1;

  const flushDeclaration = (): void => {
    const chunk = buffer.trim();
    buffer = "";
    if (chunk === "" || chunk.startsWith("@")) return;
    const colonIndex = chunk.indexOf(":");
    if (braceDepth === 0 || colonIndex === -1) return;
    declarations.push({
      property: chunk.slice(0, colonIndex).trim(),
      value: chunk.slice(colonIndex + 1).trim(),
      line: bufferStartLine,
    });
  };

  for (const character of withoutComments) {
    if (character === "\n") currentLine += 1;
    if (character === "{") {
      braceDepth += 1; // the buffer was a selector or at-rule prelude — structural
      buffer = "";
    } else if (character === "}") {
      flushDeclaration(); // a final declaration may omit its semicolon
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (character === ";") {
      flushDeclaration();
    } else {
      if (buffer.trim() === "") bufferStartLine = currentLine;
      buffer += character;
    }
  }
  return declarations;
}

/** Validate one declaration value against the token-only grammar; returns offending parts. */
export function findOffTokenValueParts(value: string): string[] {
  return value
    .split(/[\s,/]+/)
    .filter((part) => part !== "")
    .filter((part) => {
      if (TOKEN_REFERENCE_PATTERN.test(part)) return false;
      if (STRUCTURAL_IDENTIFIER_PATTERN.test(part) && !CSS_NAMED_COLORS.has(part.toLowerCase())) {
        return false;
      }
      return true; // numbers, lengths, hex, functions, strings, named colors, !important
    });
}

export function findComponentsCssViolations(filePath: string, css: string): string[] {
  return extractCssDeclarations(css).flatMap(({ property, value, line }) =>
    findOffTokenValueParts(value).map(
      (part) =>
        `${filePath}:${line} [components-css-token-purity] ${property}: ${value} — "${part}" ` +
        "is not a var(--mc-...) token reference or a structural keyword",
    ),
  );
}

const COMPONENTS_CSS_PATH = "packages/design-system/src/lib/styles/components.css";

describe("components.css token purity (golden rule 2; ADR-0076 component-layer discipline)", () => {
  const componentsCss = readFileSync(join(REPOSITORY_ROOT, COMPONENTS_CSS_PATH), "utf8");

  it("is the recipes layer we expect (vacuity guard)", () => {
    // If the layer wrapper ever disappears, the parse below could be inspecting nothing.
    expect(componentsCss).toContain("@layer components");
  });

  it("every declaration value is a token reference or structural keyword", () => {
    expect(findComponentsCssViolations(COMPONENTS_CSS_PATH, componentsCss)).toEqual([]);
  });

  it("accepts a clean token-fed recipe (self-check)", () => {
    const clean = `
      @layer components {
        .mc-button {
          display: inline-flex;
          cursor: pointer;
          color: var(--mc-color-action-primary-foreground);
          background-color: var(--mc-color-action-primary);
          border: var(--mc-border-width-default) solid var(--mc-color-border-default);
          border-radius: var(--mc-radius-md);
          transition-duration: var(--mc-duration-fast);
          background-clip: padding-box;
        }
      }`;
    expect(findComponentsCssViolations("crafted.css", clean)).toEqual([]);
  });

  it("catches crafted literal values when recipes land (self-check)", () => {
    // Part-level grammar checks, value by value:
    expect(findOffTokenValueParts("12px 16px")).toEqual(["12px", "16px"]);
    expect(findOffTokenValueParts("#2563eb")).toEqual(["#2563eb"]);
    expect(findOffTokenValueParts("red")).toEqual(["red"]); // named colors are not structural
    expect(findOffTokenValueParts("Red")).toEqual(["Red"]); // ...case-insensitively
    expect(findOffTokenValueParts("0 1px 2px rgb(0 0 0 / 0.05)")).not.toEqual([]);
    expect(findOffTokenValueParts("50")).toEqual(["50"]);
    expect(findOffTokenValueParts("opacity 150ms ease")).toEqual(["150ms"]);
    expect(findOffTokenValueParts('"Inter"')).toEqual(['"Inter"']);
    // A var() fallback argument could smuggle a literal — the whole form is rejected.
    expect(findOffTokenValueParts("var(--mc-color-surface-default, #fff)")).not.toEqual([]);
    expect(findOffTokenValueParts("var(--mc-border-width-default) !important")).toEqual([
      "!important",
    ]);
    // ...and end to end through the parser: each offending declaration is reported.
    const crafted = `
      @layer components {
        .mc-button {
          color: var(--mc-color-action-primary-foreground);
          padding: 12px 16px;
          background: #2563eb;
          z-index: 50;
        }
      }`;
    const violations = findComponentsCssViolations("crafted.css", crafted);
    expect(violations).toHaveLength(4); // 12px, 16px, #2563eb, 50 — the clean color line is not flagged
    expect(violations.every((violation) => violation.startsWith("crafted.css:"))).toBe(true);
  });

  it("reports the file, line number, property, and offending part (self-check)", () => {
    const crafted = "@layer components {\n  .mc-x {\n    color: #fff;\n  }\n}";
    expect(findComponentsCssViolations("crafted.css", crafted)).toEqual([
      'crafted.css:3 [components-css-token-purity] color: #fff — "#fff" ' +
        "is not a var(--mc-...) token reference or a structural keyword",
    ]);
  });

  it("treats selectors, at-rules, and comments as structural, not declarations (self-check)", () => {
    const structuralOnly = `
      /* a comment with color: #fff inside stays a comment */
      @import "tailwindcss";
      @layer components {
        .mc-button:hover[data-state="open"] { }
      }`;
    expect(extractCssDeclarations(structuralOnly)).toEqual([]);
  });
});
