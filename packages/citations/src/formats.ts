/*
 * Citation formats. A format is a base style plus the differences one court or state makes to it,
 * each difference naming the rule it comes from so a reviewer can check it — the same shape as the
 * trust-jurisdiction profiles (packages/trust-jurisdictions). A format no attorney has reviewed is
 * never chosen automatically.
 *
 * Base styles:
 *   uniform     the Uniform System of Citation, as published in The Indigo Book (public domain, CC0).
 *               The Bluebook's text is copyrighted and its name a trademark, so neither appears here.
 *   california  the California Style Manual, which California state courts accept in place of the
 *               uniform system provided a filer is consistent.
 */

export type BaseStyle = "uniform" | "california";

export type DifferenceIdentifier =
  /** Statutes in the court's own short form: "NRS 11.190" for "Nev. Rev. Stat. § 11.190 (2025)". */
  | "nevada-statute-form"
  /** NRAP 36(c)(3): which unpublished dispositions may be cited, and the parts their citation needs. */
  | "nevada-unpublished-dispositions";

export interface FormatDifference {
  readonly identifier: DifferenceIdentifier;
  readonly summary: string;
  /** The rule the difference comes from, or "Firm choice" where it is a house preference. */
  readonly source: string;
}

export interface CitationFormat {
  readonly identifier: string;
  readonly name: string;
  readonly base: BaseStyle;
  readonly reviewed: boolean;
  /** Two-letter state codes this format is the default for. */
  readonly states: readonly string[];
  /** Court identifiers this format is the default for. */
  readonly courts: readonly string[];
  readonly differences: readonly FormatDifference[];
}

export const UNIFORM_FORMAT: CitationFormat = {
  identifier: "uniform",
  name: "Uniform System (Indigo Book)",
  base: "uniform",
  reviewed: true,
  states: [],
  courts: [],
  differences: [],
};

export const NEVADA_FORMAT: CitationFormat = {
  identifier: "nevada-state-courts",
  name: "Nevada State Courts",
  base: "uniform",
  reviewed: true,
  states: ["NV"],
  courts: ["nevada-supreme-court", "nevada-court-of-appeals", "nevada-district-courts"],
  differences: [
    {
      identifier: "nevada-unpublished-dispositions",
      summary:
        "An unpublished disposition may be cited only if the Supreme Court issued it on or after 1 January 2016, or the Court of Appeals on or after 15 August 2024; cite an electronic database if available, the docket number and the date filed, noted as an unpublished disposition.",
      source: "NRAP 36(c)(3)",
    },
    {
      identifier: "nevada-statute-form",
      summary: "Statutes are cited in the form Nevada's courts use: NRS 11.190.",
      source: "Firm choice",
    },
  ],
};

export const CALIFORNIA_FORMAT: CitationFormat = {
  identifier: "california-state-courts",
  name: "California State Courts",
  base: "california",
  reviewed: true,
  states: ["CA"],
  courts: ["california-supreme-court", "california-court-of-appeal", "california-superior-courts"],
  differences: [],
};

export const SHIPPED_FORMATS: readonly CitationFormat[] = [
  UNIFORM_FORMAT,
  NEVADA_FORMAT,
  CALIFORNIA_FORMAT,
];

export function hasDifference(format: CitationFormat, identifier: DifferenceIdentifier): boolean {
  return format.differences.some((difference) => difference.identifier === identifier);
}

export interface FormatContext {
  /** A format chosen on the document itself; wins even when unreviewed, because a person chose it. */
  readonly documentFormat?: string | null;
  readonly matterCourt?: string | null;
  readonly matterState?: string | null;
  /** The firm's default format identifier. */
  readonly firmDefault?: string | null;
}

/**
 * Which format applies: the document's own, then the matter's court, then the matter's state, then
 * the firm default, then the uniform system. Only a reviewed format is chosen for a court, state or
 * firm default.
 */
export function resolveFormat(
  context: FormatContext,
  formats: readonly CitationFormat[] = SHIPPED_FORMATS,
): CitationFormat {
  const byIdentifier = (identifier: string | null | undefined): CitationFormat | undefined =>
    identifier == null ? undefined : formats.find((format) => format.identifier === identifier);

  const chosen = byIdentifier(context.documentFormat);
  if (chosen !== undefined) return chosen;

  const reviewed = formats.filter((format) => format.reviewed);
  const court = context.matterCourt;
  const forCourt =
    court == null ? undefined : reviewed.find((format) => format.courts.includes(court));
  if (forCourt !== undefined) return forCourt;

  const state = context.matterState?.toUpperCase();
  const forState =
    state === undefined ? undefined : reviewed.find((format) => format.states.includes(state));
  if (forState !== undefined) return forState;

  const firmDefault = byIdentifier(context.firmDefault);
  if (firmDefault?.reviewed === true) return firmDefault;

  return UNIFORM_FORMAT;
}
