import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parser for the Terrazzo-generated CSS (generated/tokens.css), shared by the
 * completeness and (later) contrast gates.
 *
 * Policy — media blocks: the generated file nests `@media (color-gamut: p3|rec2020)`
 * refinement blocks between the base context blocks. Those refinements are color-space
 * upgrades of variables the base block already defines — not separate theme-or-mode
 * contexts — so the gates assert against `base` only. The media blocks are still parsed
 * and exposed under `media` (keyed by the media condition) so nothing is silently
 * dropped and a future gate can reason about gamut refinements.
 *
 * The parser is deliberately strict: any line it does not recognize throws, so a change
 * in Terrazzo's output shape fails the gate loudly instead of being silently skipped.
 */

export interface ContextVariables {
  /** selector → variable name → value */
  [selector: string]: Record<string, string>;
}

export interface ParsedGeneratedCss {
  /** Top-level (non-media) selector blocks — the gates' source of truth. */
  base: ContextVariables;
  /** `@media`-nested refinement blocks, keyed by the media condition. */
  media: { [condition: string]: ContextVariables };
}

const PACKAGE_ROOT = join(import.meta.dirname, "..");

/** Parse a generated CSS file (path relative to the package root). */
export function parseGeneratedCss(file = "generated/tokens.css"): ParsedGeneratedCss {
  return parseGeneratedCssText(readFileSync(join(PACKAGE_ROOT, file), "utf8"));
}

const DECLARATION_PATTERN = /^(--[\w-]+)\s*:\s*(.+);$/;

/** Parse generated-CSS text. Exported separately so tests can probe the policy directly. */
export function parseGeneratedCssText(css: string): ParsedGeneratedCss {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const base: ContextVariables = {};
  const media: { [condition: string]: ContextVariables } = {};

  let currentMediaCondition: string | null = null;
  let currentSelector: string | null = null;

  for (const rawLine of withoutComments.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    if (line.startsWith("@media")) {
      if (currentMediaCondition !== null || currentSelector !== null || !line.endsWith("{")) {
        throw new Error(`Unexpected @media nesting in generated CSS: "${line}"`);
      }
      currentMediaCondition = line.slice("@media".length, -1).trim();
      continue;
    }

    if (line.endsWith("{")) {
      if (currentSelector !== null) {
        throw new Error(`Unexpected nested block in generated CSS: "${line}"`);
      }
      currentSelector = line.slice(0, -1).trim();
      const contexts =
        currentMediaCondition === null ? base : (media[currentMediaCondition] ??= {});
      contexts[currentSelector] ??= {};
      continue;
    }

    if (line === "}") {
      if (currentSelector !== null) currentSelector = null;
      else if (currentMediaCondition !== null) currentMediaCondition = null;
      else throw new Error("Unbalanced closing brace in generated CSS");
      continue;
    }

    const declaration = DECLARATION_PATTERN.exec(line);
    if (declaration === null || currentSelector === null) {
      throw new Error(`Unrecognized line in generated CSS: "${line}"`);
    }
    const contexts = currentMediaCondition === null ? base : media[currentMediaCondition];
    const variables = contexts?.[currentSelector];
    if (variables === undefined) {
      throw new Error(`Declaration outside any block: "${line}"`);
    }
    variables[declaration[1] as string] = (declaration[2] as string).trim();
  }

  if (currentSelector !== null || currentMediaCondition !== null) {
    throw new Error("Unterminated block in generated CSS");
  }
  return { base, media };
}
