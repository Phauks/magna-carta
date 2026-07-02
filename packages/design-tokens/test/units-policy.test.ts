/*
 * Units-policy gate: WHICH unit each dimension namespace uses is a design decision, pinned here
 * so it cannot drift token by token.
 *
 * The policy (and the reasoning it encodes):
 *  - rem for everything that must scale WITH the user's text size (WCAG 1.4.4): type sizes and
 *    letter-spacing. A px value in these namespaces silently breaks the accommodation — tracking
 *    was exactly this bug (1px tracking tightened relative to growing glyphs at 200% text size).
 *  - px for everything that must NOT scale with text: hairline borders and focus rings (a 1px
 *    rule that becomes 2px at 200% text is a different design), radii, shadows' geometry, the
 *    spacing grid, control-height FLOORS (recipes use min-block-size, so text growth expands the
 *    control past the px floor — the floor itself is a pointer-target/rhythm concern), and
 *    chrome layout sizes.
 *
 * A blanket "rem everywhere" would be wrong, not stricter: device-pixel crispness is the point
 * of a hairline. The gate enforces the POLICY, not a unit. Because the recipe purity gate
 * already bans literal lengths in components.css, enforcing units at the token source covers
 * the entire styled surface.
 *
 * space.* staying px (not scaling whitespace with text size) is the one genuinely contestable
 * line — revisit deliberately if low-vision feedback wants breathing room to grow too; flipping
 * it is a token-file change plus this map, nothing else.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

/** Top-level token group → required unit for every $type: "dimension" token in it. */
const DIMENSION_UNIT_POLICY: Record<string, "px" | "rem"> = {
  "font-size": "rem",
  tracking: "rem",
  space: "px",
  radius: "px",
  control: "px",
  "focus-ring": "px",
  "border-width": "px",
  size: "px",
};

interface DimensionToken {
  readonly name: string;
  readonly unit: string;
}

function collectDimensionTokens(node: unknown, path = ""): DimensionToken[] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return [];
  const record = node as Record<string, unknown>;
  if ("$value" in record) {
    if (record["$type"] !== "dimension") return [];
    const value = record["$value"];
    // Alias dimensions ({density.gutter} → "{space.16}") carry no unit of their own — the
    // aliased primitive's namespace already answers for it.
    if (typeof value === "string") return [];
    const unit = (value as { unit?: string }).unit ?? "";
    return [{ name: path, unit }];
  }
  return Object.entries(record)
    .filter(([key]) => !key.startsWith("$"))
    .flatMap(([key, child]) => collectDimensionTokens(child, path === "" ? key : `${path}.${key}`));
}

const SOURCE_FILES = [
  "tokens/primitives/dimension.json",
  "tokens/primitives/typography.json",
  "tokens/semantic.json",
  "tokens/density/compact.json",
];

const allDimensionTokens = SOURCE_FILES.flatMap((file) =>
  collectDimensionTokens(JSON.parse(readFileSync(join(PACKAGE_ROOT, file), "utf8"))),
);

describe("dimension units follow the per-namespace policy", () => {
  it("collects a real token surface (vacuity guard)", () => {
    const names = allDimensionTokens.map(({ name }) => name);
    expect(names).toContain("font-size.sm");
    expect(names).toContain("tracking.caps");
    expect(names).toContain("space.16");
    expect(names).toContain("border-width.default");
    expect(allDimensionTokens.length).toBeGreaterThanOrEqual(25);
  });

  it("every dimension namespace HAS a policy (a new group must take a side)", () => {
    const unpoliced = allDimensionTokens
      .map(({ name }) => name.split(".")[0] as string)
      .filter((group) => !(group in DIMENSION_UNIT_POLICY));
    expect([...new Set(unpoliced)]).toEqual([]);
  });

  it("every dimension token uses its namespace's unit", () => {
    const violations = allDimensionTokens
      .filter(({ name, unit }) => {
        const group = name.split(".")[0] as string;
        const required = DIMENSION_UNIT_POLICY[group];
        return required !== undefined && unit !== required;
      })
      .map(({ name, unit }) => `${name}: ${unit}`);
    expect(violations).toEqual([]);
  });

  it("the collector sees units and skips aliases (self-check)", () => {
    const crafted = {
      "font-size": { rogue: { $type: "dimension", $value: { value: 13, unit: "px" } } },
      density: { gutter: { $type: "dimension", $value: "{space.16}" } },
    };
    const collected = collectDimensionTokens(crafted);
    expect(collected).toEqual([{ name: "font-size.rogue", unit: "px" }]);
  });
});
