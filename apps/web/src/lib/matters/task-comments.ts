/*
 * The words of a task comment, and the colleagues it names.
 *
 * A comment names a colleague by id; "@Dana Okafor" in its words is the author's own text, kept so
 * the thread reads naturally. These helpers keep the two in step: a name the author deleted from the
 * words is no longer sent as named, and the thread shows in bold only the names the comment holds.
 */

export interface NamedPerson {
  userId: string;
  displayName: string;
}

/** One run of a comment's words, marked where it is a colleague the comment names. */
export interface CommentSegment {
  text: string;
  named: boolean;
}

/** The people named whose "@Name" is still in the words, each once, in the order given. */
export function namesStillWritten(body: string, named: readonly NamedPerson[]): string[] {
  const kept = named.filter((person) => body.includes(`@${person.displayName}`));
  return [...new Set(kept.map((person) => person.userId))];
}

/**
 * The words split at each "@Name" of a colleague the comment names. Longer names are tried first,
 * so "@Dana Okafor-Reyes" is not read as "@Dana Okafor" followed by "-Reyes".
 */
export function commentSegments(body: string, named: readonly NamedPerson[]): CommentSegment[] {
  const marks = [...new Set(named.map((person) => `@${person.displayName}`))].toSorted(
    (left, right) => right.length - left.length,
  );
  const segments: CommentSegment[] = [];
  let plain = "";
  let at = 0;
  while (at < body.length) {
    const mark =
      body[at] === "@" ? marks.find((candidate) => body.startsWith(candidate, at)) : undefined;
    if (mark === undefined) {
      plain += body[at];
      at += 1;
      continue;
    }
    if (plain !== "") segments.push({ text: plain, named: false });
    plain = "";
    segments.push({ text: mark, named: true });
    at += mark.length;
  }
  if (plain !== "") segments.push({ text: plain, named: false });
  return segments;
}

/** The draft with a colleague's "@Name " added, replacing a lone "@" the author just typed. */
export function withNameAdded(draft: string, person: NamedPerson): string {
  const base = draft.endsWith("@") ? draft.slice(0, -1) : draft;
  const spacer = base === "" || /\s$/u.test(base) ? "" : " ";
  return `${base}${spacer}@${person.displayName} `;
}

/** "Rosalind, the Litigation Team and Dana are told", from the names of the people on the task. */
export function toldSentence(names: readonly string[]): string {
  if (names.length === 0)
    return "Nobody else is on this task, so only the people you name are told.";
  const list =
    names.length === 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return `${list} ${names.length === 1 ? "is" : "are"} told, and anyone you name.`;
}
