// The rule behind `pnpm run lint:stale-response`, as a pure function over file text.

/** `stale-response:allow — <reason>`; a bare marker is itself a failure. */
const EXEMPTION = /stale-response:allow\s*(?:—|--)?\s*(.*)/;

export function exemptionReason(text) {
  const match = EXEMPTION.exec(text);
  if (match === null) return null;
  return (match[1] ?? "").trim();
}

/**
 * A hand-rolled staleness guard: a private counter that is both INCREMENTED and COMPARED.
 *
 * That pair is the whole signature, and it is precise. A counter only incremented is a tally; one
 * only compared is reading somebody else's. Incrementing and then comparing the same field is
 * somebody re-deriving "is this answer still the newest", which four screens had each done
 * separately before `LatestOnly` existed. They agreed with each other, which was luck: the bug the
 * pattern prevents — an older read resolving last and overwriting a newer one — is invisible in every
 * test that resolves one read at a time, so a copy written slightly wrong stays green.
 */
export function findHandRolledStaleGuards(source) {
  const guards = [];
  const incremented = new Set(
    [...source.matchAll(/this\.(#[A-Za-z_]\w*)\s*(?:\+=\s*1|\+\+)/g)].map((one) => one[1]),
  );
  if (incremented.size === 0) return guards;
  for (const match of source.matchAll(/(?:!==|===)\s*this\.(#[A-Za-z_]\w*)/g)) {
    const field = match[1];
    if (!incremented.has(field)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    if (guards.some((one) => one.field === field)) continue;
    guards.push({ field, line });
  }
  return guards;
}

/** Whether this file has opted out, anywhere in it. */
export function fileIsExempt(source) {
  return exemptionReason(source) !== null;
}
