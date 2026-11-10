/*
 * A text a search result shows, cut into the runs a screen draws: the reader's words, and what is
 * between them.
 *
 * The server says where the words are, as offsets into the text it sent (`titleMarks` and
 * `snippetMarks` on a hit). It found them by the rules of the index that made the match, so this
 * module finds nothing and knows nothing about words. It only cuts.
 *
 * IT NEVER FAILS A RESULT. Marks that are absent (an answer from a server a deploy behind), out of
 * order, overlapping or past the end of the text are dropped or clamped, and the text is still
 * shown whole. A mark is an addition to a result, and the worst a bad one may cost is itself.
 */

/** Where one run of the reader's words is: offsets in UTF-16 code units, the end not included. */
export interface TextMark {
  readonly start: number;
  readonly end: number;
}

export interface TextRun {
  readonly text: string;
  /** Whether this run is the reader's words. */
  readonly marked: boolean;
}

/** The runs of `text`, in order, which joined together are `text` exactly. */
export function markedRuns(
  text: string,
  marks: readonly TextMark[] | null | undefined,
): readonly TextRun[] {
  if (text === "") return [];
  const runs: TextRun[] = [];
  let at = 0;
  for (const mark of marks ?? []) {
    if (!Number.isInteger(mark.start) || !Number.isInteger(mark.end)) continue;
    const start = Math.max(mark.start, at);
    const end = Math.min(mark.end, text.length);
    // A mark that begins before the last one ended has had that part drawn already; one with
    // nothing left of it is skipped.
    if (end <= start) continue;
    if (start > at) runs.push({ text: text.slice(at, start), marked: false });
    runs.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length) runs.push({ text: text.slice(at), marked: false });
  return runs;
}
