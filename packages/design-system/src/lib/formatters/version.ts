/*
 * How a document's version reads.
 *
 * A version is a BARE NUMBER — "12", never "v12" — in a Version column, a version row, a tooltip, a
 * dialog and a history's from/to. The one exception is prose: where a bare number would dangle in a
 * sentence with nothing naming what it counts, it reads "version 12" instead.
 *
 * Two consequences of it being an identifier rather than a quantity:
 *
 *   - No grouping separator, ever. "1024" is one token; "1,024" is two, and a label a reader has to
 *     reassemble is not a label. This is why the number is stringified directly rather than run
 *     through a locale number format.
 *   - Tabular figures are OFF wherever the result is rendered. Tabular digits are for columns of
 *     quantities that must align; on a version they space the glyphs so far apart that "12" starts
 *     to read as "1 2". That is the consuming class's job, not this function's, but it is the same
 *     rule and it gets lost if it is not written down beside it.
 */

export interface VersionOptions {
  /**
   * True where the number appears inside a sentence, which is the only place it takes the word.
   * The word is lowercase because that is where prose puts it.
   */
  inProse?: boolean;
}

/**
 * A version as it is written on a surface.
 *
 * A value that is not a finite number is shown as what actually arrived, and never takes the prose
 * word: naming a non-number as a version would state something the data does not support.
 */
export function formatVersion(version: number, options: VersionOptions = {}): string {
  const bare = String(version);
  if (!Number.isFinite(version)) return bare;
  return options.inProse === true ? `version ${bare}` : bare;
}
