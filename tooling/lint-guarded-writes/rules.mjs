// The rules behind `pnpm run lint:guarded-writes`. Pure functions over file text, so every one of
// them is measured in index.test.mjs against the shapes it is supposed to catch AND the shapes it
// must leave alone.

/** A statement builder composes this when its WHERE carries more than the row's identity. */
const GUARD_SHAPED = /\b(?:UPDATE|DELETE)\b[\s\S]*?\bWHERE\b[^`]*?\bAND\b/i;

/** `fitness:unguarded-write — <reason>`; a bare marker with no reason is itself a failure. */
const EXEMPTION = /fitness:unguarded-write\s*(?:—|--)?\s*(.*)/;

/**
 * The statement builders a file exports, each with the SQL it composes.
 *
 * Deliberately textual. A builder here is always the same shape — an exported function whose body
 * prepares one template-literal statement — and a parser would buy nothing but a dependency, while a
 * regex that misreads an unusual shape simply does not list it, which is the safe direction to fail.
 */
export function readStatementBuilders(source) {
  const builders = [];
  const pattern = /export function (\w+)\(([\s\S]*?)\n\}/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, body] = match;
    const sql = [...body.matchAll(/`([\s\S]*?)`/g)].map((one) => one[1]).join(" ");
    if (sql === "") continue;
    builders.push({
      name,
      sql,
      guardShaped: GUARD_SHAPED.test(sql),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return builders;
}

/** Whether the text immediately before a call site is `guarded(`, whitespace collapsed. */
function wrappedInGuarded(source, callIndex) {
  const before = source.slice(Math.max(0, callIndex - 200), callIndex).replace(/\s+/g, "");
  return before.endsWith("guarded(");
}

/** Every call of `name(` in `source`, each marked with whether `guarded()` wraps it. */
export function findCallSites(source, name, file) {
  const sites = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (const match of source.matchAll(pattern)) {
    // The declaration is not a call of itself.
    const declaration = source.slice(Math.max(0, match.index - 20), match.index);
    if (/\b(?:function|const|let)\s*$/.test(declaration)) continue;
    sites.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      guarded: wrappedInGuarded(source, match.index),
    });
  }
  return sites;
}

/** The exemption's reason, `null` when there is no marker, `""` when the marker gave no reason. */
export function exemptionReason(text) {
  const match = EXEMPTION.exec(text);
  if (match === null) return null;
  return (match[1] ?? "").trim();
}

/**
 * RULE 1 — a builder guarded at one call site is guarded at all of them.
 *
 * The erosion rule, and the reason it is the hard one. A guard that half its callers apply is worse
 * than no guard at all: the protected path proves the mechanism works, so nobody looks again, and the
 * unprotected one carries exactly the bug the guard was added to close. A new call site is where this
 * happens, because the statement already looks guarded from where the author is standing.
 */
export function findInconsistentGuards(builders, callSitesByName) {
  const problems = [];
  for (const builder of builders) {
    const sites = callSitesByName.get(builder.name) ?? [];
    const guarded = sites.filter((site) => site.guarded);
    if (guarded.length === 0) continue;
    for (const site of sites.filter((site) => !site.guarded)) {
      problems.push({
        rule: "inconsistent-guard",
        file: site.file,
        line: site.line,
        detail:
          `\`${builder.name}\` is wrapped in guarded() at ${String(guarded.length)} other call site(s) and not here. ` +
          `A guard applied by some callers and not others leaves the unguarded path carrying the bug the guard closes, ` +
          `while the guarded one keeps proving the mechanism works. Wrap it, or exempt this call site with ` +
          `\`fitness:unguarded-write — <reason>\` on the line above.`,
      });
    }
  }
  return problems;
}

/**
 * RULE 2 — an exemption states a reason.
 *
 * A bare marker is a silenced check with nobody's name on it. The reason is what a later reader
 * needs to decide whether it still holds.
 */
export function findBareExemptions(files) {
  const problems = [];
  for (const { file, source } of files) {
    for (const [index, line] of source.split("\n").entries()) {
      if (!/fitness:unguarded-write/.test(line)) continue;
      if (exemptionReason(line) === "") {
        problems.push({
          rule: "bare-exemption",
          file,
          line: index + 1,
          detail:
            "`fitness:unguarded-write` with no reason after it. Say why this write cannot carry its " +
            "precondition into the statement, so the next reader can tell whether it is still true.",
        });
      }
    }
  }
  return problems;
}

/**
 * RULE 3 — the interleaving harness is used in the shape that cannot pass vacuously.
 *
 * `runInterleaved` refuses when its point was never reached; `interleaveAt` cannot, because it does
 * not know when the operation ended. A test reaching for the lower-level one therefore owes an
 * assertion on `.interleaved` — without it the competing writer may never have run, and the test
 * passes as a single-caller test wearing a concurrency test's name.
 */
export function findUncheckedInterleaves(files) {
  const problems = [];
  for (const { file, source } of files) {
    if (!/\binterleaveAt\s*\(/.test(source)) continue;
    if (/\.interleaved\b/.test(source)) continue;
    problems.push({
      rule: "unchecked-interleave",
      file,
      line: source.slice(0, source.search(/\binterleaveAt\s*\(/)).split("\n").length,
      detail:
        "uses interleaveAt() without ever reading `.interleaved`. Nothing here proves the competing " +
        "writer ran, so this passes whether or not the race happened. Prefer runInterleaved(), which " +
        "refuses when its point was never reached, or assert `.interleaved` yourself.",
    });
  }
  return problems;
}

/**
 * RULE 4 — nobody re-implements the harness locally.
 *
 * It was invented once per package before it was shared, and each copy was a little different and
 * silently vacuous in its own way. A local BatchDatabase literal whose `batch` awaits something before
 * delegating is that copy coming back.
 */
export function findLocalInterleaveHelpers(files) {
  const problems = [];
  for (const { file, source } of files) {
    if (/@magna-carta\/data-access\/interleave/.test(source)) continue;
    const match =
      /batch:\s*async\s*\([\s\S]{0,120}?\)\s*=>\s*\{[\s\S]{0,200}?await\s+\w+\(\)[\s\S]{0,200}?\.batch\(/.exec(
        source,
      );
    if (match === null) continue;
    problems.push({
      rule: "local-interleave-helper",
      file,
      line: source.slice(0, match.index).split("\n").length,
      detail:
        "looks like a hand-rolled interleaving database — a batch() that runs something else before " +
        "delegating. Use `@magna-carta/data-access/interleave`; the shared one names its point and " +
        "fails when that point is never reached, which a local copy has never yet done.",
    });
  }
  return problems;
}

/** Guard-shaped builders nothing wraps — the triage backlog, reported rather than failed. */
export function findUnwrappedGuardShaped(builders, callSitesByName) {
  return builders
    .filter((builder) => builder.guardShaped)
    .filter((builder) => !(callSitesByName.get(builder.name) ?? []).some((site) => site.guarded));
}
