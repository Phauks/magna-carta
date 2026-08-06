import { formatMergeValue, legalFormatsFor } from "../format.ts";
import type { MergeValue, MergeValueType } from "../types.ts";

// Sample renderings, produced by running an INVENTED value through the REAL format table.
//
// A hand-written example is a second copy of what the formatter does, free to disagree with it. This
// cannot: if the table gains a format, the example follows, and if a format has no rendering behind it
// the fitness test sees the gap. Nothing here is ever firm data — an example ships with the entry, so a
// catalogue response is safe to show before a matter is chosen and safe to cache in a browser.
//
// The zone is fixed because every example value is a calendar date or a string. Nothing here is an
// instant, so nothing here depends on an office's time zone.
const EXAMPLE_TIME_ZONE = "UTC";

export function exampleRenderingsFor(
  valueType: MergeValueType,
  example: MergeValue | undefined,
): Readonly<Record<string, string>> {
  const renderings: Record<string, string> = {};
  if (example === undefined) return renderings;
  for (const format of legalFormatsFor(valueType)) {
    const rendered = formatMergeValue(example, format, { timeZone: EXAMPLE_TIME_ZONE });
    if (rendered !== undefined) renderings[format] = rendered;
  }
  return renderings;
}
