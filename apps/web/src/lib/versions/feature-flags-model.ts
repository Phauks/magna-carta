/*
 * The Feature Flags tab: every flag in the catalog (@magna-carta/feature-flags), what this firm's
 * release channel resolves it to, and the safe default it falls back to. The values come from the
 * session bootstrap, which evaluates the whole catalog for every session anyway, so the tab asks
 * nothing new; the catalog supplies each flag's stage and description.
 *
 * A flag the session carries that the catalog does not list is shown too, under its key alone:
 * the bootstrap is the authority on what this session resolved, and dropping a row because the
 * words are missing would hide exactly the flag somebody is asking about.
 */
import { FLAG_CATALOG, type FlagStage } from "@magna-carta/feature-flags/catalog";

export interface FeatureFlagRow {
  readonly key: string;
  readonly value: boolean | null;
  readonly defaultValue: boolean | null;
  readonly stage: FlagStage | null;
  readonly description: string | null;
}

/** The tab's label. */
export const FEATURE_FLAGS_SECTION_LABEL = "Feature Flags";

export function featureFlagRows(
  sessionFlags: Readonly<Record<string, boolean>> | null,
): FeatureFlagRow[] {
  const keys = new Set([...Object.keys(FLAG_CATALOG), ...Object.keys(sessionFlags ?? {})]);
  return [...keys].sort().map((key) => {
    const entry = FLAG_CATALOG[key];
    return {
      key,
      value: sessionFlags?.[key] ?? null,
      defaultValue: entry?.defaultValue ?? null,
      stage: entry?.stage ?? null,
      description: entry?.description ?? null,
    };
  });
}

export function flagValueLabel(value: boolean | null): string {
  if (value === null) return "Not resolved";
  return value ? "On" : "Off";
}

/** A flag that resolves away from its default is the interesting one: something turned it. */
export function flagDiffersFromDefault(row: FeatureFlagRow): boolean {
  return row.value !== null && row.defaultValue !== null && row.value !== row.defaultValue;
}

export function flagStageLabel(stage: FlagStage | null): string | null {
  if (stage === null) return null;
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}
