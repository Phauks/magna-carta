/*
 * The ratchet: reading, comparing and re-rendering baseline.json. Pure over its inputs, with no
 * filesystem in it, so the four outcomes below are unit-tested rather than believed. The runner is
 * index.mjs; the rules are rules.mjs.
 *
 * WHY A RATCHET AND NOT AN ALLOWANCE LIST. The tree already answers "what is money" in a hundred and
 * fifty places outside @magna-carta/money. A gate that failed on all of them would be switched off
 * within a day, and a list of named exemptions would be read as permission — the sites would still
 * be there in a year, each with a line in a file saying it was fine. So the register records a
 * NUMBER per file and nothing else, and the number may only fall:
 *
 *   - at or under the recorded count       passes,
 *   - a file with no entry, any finding    fails — new debt cannot arrive by accident,
 *   - over the recorded count              fails, naming both numbers,
 *   - UNDER the recorded count             fails, naming the number to record instead.
 *
 * The last is the whole mechanism. Slack left behind after a fix is slack the next change spends
 * silently, so paying debt down and re-recording it are one commit, and tightening the ratchet is
 * editing one integer that the failure message has already printed.
 *
 * COUNTS, NEVER LINE NUMBERS. A line number churns every time anything above it is edited, so a
 * register of them would fail on a reformat and would be regenerated rather than read. A count only
 * moves when the thing it counts moves.
 *
 * The entry is per FILE rather than per rule, because a burn-down moves a whole file at once: the
 * display conversions in one surface, or the second money engine in one module. A file that reaches
 * zero loses its line entirely and cannot come back without the deletion showing in a diff.
 *
 * Run: see index.mjs. `--update-baseline` re-records everything from the current tree.
 */

/** The one-line explanation carried inside the register, for whoever opens it before this file. */
export const BASELINE_NOTE =
  "Money arithmetic outside @magna-carta/money, per file, as of the last recording. A DEBT " +
  "REGISTER: a count may fall and must then be re-recorded here, a file may leave, and nothing may " +
  "arrive except by a deliberate edit. tooling/lint-money-arithmetic/rules.mjs says why.";

/**
 * Parse the register, refusing anything that is not a whole number of findings.
 *
 * Throws rather than returning an empty register on bad input. An unreadable register that degraded
 * to "nothing is recorded" would fail every file at once and be fixed by regenerating, which forgives
 * the debt it exists to hold — so the failure has to be unmistakably about the file itself.
 */
export function parseBaseline(text) {
  const parsed = JSON.parse(text);
  const counts = parsed?.counts;
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    throw new TypeError("baseline.json has no `counts` object");
  }
  for (const [file, count] of Object.entries(counts)) {
    if (!Number.isInteger(count) || count < 1) {
      throw new TypeError(
        `baseline.json records ${JSON.stringify(count)} for ${file}; every entry is a whole ` +
          "number of findings, at least one — a file with no findings has no line",
      );
    }
  }
  return new Map(Object.entries(counts));
}

/** The register as it is written to disk: sorted by path, empty entries dropped, one trailing newline. */
export function renderBaseline(countsByFile) {
  const counts = Object.fromEntries(
    [...countsByFile]
      .filter(([, count]) => count > 0)
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
  return `${JSON.stringify({ note: BASELINE_NOTE, counts }, null, 2)}\n`;
}

/**
 * The four outcomes, as two lists.
 *
 * `overBudget` is debt that arrived; `newlyClean` is debt that was paid and not re-recorded. Both
 * fail. `knownFiles` is the set of paths the tree still holds, so an entry for a deleted file is
 * reported as gone rather than as mysteriously quiet.
 */
export function compareAgainstBaseline(foundByFile, baseline, knownFiles = new Set()) {
  const overBudget = [];
  const newlyClean = [];
  for (const [file, findings] of foundByFile) {
    const allowed = baseline.get(file) ?? 0;
    if (findings.length > allowed) overBudget.push({ file, allowed, findings });
  }
  for (const [file, allowed] of baseline) {
    const actual = foundByFile.get(file)?.length ?? 0;
    if (actual < allowed) {
      newlyClean.push({ file, allowed, actual, gone: !knownFiles.has(file) });
    }
  }
  overBudget.sort((left, right) => left.file.localeCompare(right.file));
  newlyClean.sort((left, right) => left.file.localeCompare(right.file));
  return { overBudget, newlyClean };
}
