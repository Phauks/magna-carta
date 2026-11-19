/*
 * The settings Convert With Options offers, and how a choice becomes what the job is sent with.
 *
 * What a conversion ACCEPTS is @magna-carta/conversion's answer (options.ts), taken from the engine
 * that writes the copy: an image target or an image going to PDF takes a size and grayscale, a JPEG
 * takes a quality too, and every other target takes nothing. This module only turns that into the
 * dialog's fields and back. A setting the conversion cannot honour is never shown, and never sent.
 *
 * Several files converted together take only the settings EVERY one of them accepts, for the same
 * reason the shared target list is an intersection: a setting half the files would refuse is a
 * conversion that fails partway.
 */
import {
  DEFAULT_QUALITY,
  QUALITY_LIMITS,
  acceptedOptions,
  type ConversionOptionName,
  type ConversionOptions,
} from "@magna-carta/conversion/options";

export { DEFAULT_QUALITY, QUALITY_LIMITS };

/** The size choice that leaves the image as it is. */
export const ORIGINAL_SIZE = "original";

/**
 * Longest-side sizes that fit where a copy usually goes: a filing portal's upload cap, an email,
 * a screen. Pixels on the longest side, so a portrait and a landscape page shrink alike.
 */
export const SIZE_ITEMS: { value: string; label: string }[] = [
  { value: ORIGINAL_SIZE, label: "Original size" },
  { value: "4000", label: "4,000 pixels" },
  { value: "3000", label: "3,000 pixels" },
  { value: "2000", label: "2,000 pixels" },
  { value: "1600", label: "1,600 pixels" },
  { value: "1200", label: "1,200 pixels" },
  { value: "800", label: "800 pixels" },
];

/** One format the dialog offers: the conversion graph's id, and the words the item says. */
export interface ConvertDialogTarget {
  readonly id: string;
  readonly label: string;
}

/** What the dialog holds while it is open. */
export interface ConversionChoices {
  readonly size: string;
  readonly quality: number;
  readonly grayscale: boolean;
}

export const DEFAULT_CHOICES: ConversionChoices = {
  size: ORIGINAL_SIZE,
  quality: DEFAULT_QUALITY,
  grayscale: false,
};

/**
 * The settings converting every one of `sources` into `to` accepts, in the order the dialog shows
 * them. Empty when there is no source, or when any source accepts nothing.
 */
export function settingsFor(
  sources: readonly string[],
  to: string,
): readonly ConversionOptionName[] {
  if (sources.length === 0) return [];
  const [first, ...rest] = sources.map((from) => acceptedOptions(from, to));
  return (first ?? []).filter((name) => rest.every((accepted) => accepted.includes(name)));
}

/** True when converting `sources` into any of `targets` accepts at least one setting. */
export function anySettingsFor(sources: readonly string[], targets: readonly string[]): boolean {
  return targets.some((to) => settingsFor(sources, to).length > 0);
}

/**
 * The options a job is sent with: only the settings the conversion accepts, and only the ones
 * moved off what a plain conversion would do. Undefined when nothing remains.
 */
export function optionsFromChoices(
  choices: ConversionChoices,
  accepted: readonly ConversionOptionName[],
): ConversionOptions | undefined {
  const maxDimension =
    accepted.includes("maxDimension") && choices.size !== ORIGINAL_SIZE
      ? Number(choices.size)
      : undefined;
  const quality = accepted.includes("quality") ? choices.quality : undefined;
  const grayscale = accepted.includes("grayscale") && choices.grayscale ? true : undefined;
  const options: { -readonly [Name in ConversionOptionName]?: ConversionOptions[Name] } = {};
  if (maxDimension !== undefined && Number.isFinite(maxDimension))
    options.maxDimension = maxDimension;
  if (quality !== undefined) options.quality = quality;
  if (grayscale !== undefined) options.grayscale = grayscale;
  return Object.keys(options).length === 0 ? undefined : options;
}
