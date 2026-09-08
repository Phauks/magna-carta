// Fitness function: a failure reaches the screen whole, not as a sentence squeezed out of it.
//
// WHY THIS EXISTS. The app used to read four of the twelve fields an RFC 9457 problem carries and
// throw the rest away — one surface at a time, each one flattening the problem into a string at the
// point it was caught. Thirty-odd surfaces did it, twenty-three of them dropped the Error ID that
// golden rule 4 requires on every error surface, and none of them could see `requestAccess` or
// `stepUpRequired`, so the server said "you can ask for access" and the screen said something went
// wrong. Consolidating that was a large change; letting it grow back would be a slow one, and slow
// regressions are the ones nobody notices.
//
// THE TWO IDIOMS THIS BANS are exactly the two that were there:
//
//   1. `outcome.problem.detail ?? "…"` — flattening the problem to its sentence at the catch site.
//      Hold the failure record and hand it to a failure surface; where a surface wants its own
//      words, they travel with the record (see stated() in apps/web/src/lib/diagnostics).
//
//   2. The Error ID interpolated into a message string. Five surfaces did this because it was the
//      only way they had to surface the handle at all. The band carries it as a copyable chip, so
//      the sentence goes back to being a sentence.
//
//   3. The failure RECORD interpolated into markup as text. Svelte renders an object by stringifying
//      it, so the screen reads "[object Object]" where the sentence belongs — and the Error ID,
//      the remedy and the retry all go with it. Three screens shipped this (the docket, the
//      directory, a matter's time), and each one was reported by somebody looking at it in
//      production. Unlike a surface that renders only PART of a record, this is never a design
//      choice: there is no reading of it that was intended.
//
// WHAT IT DELIBERATELY DOES NOT CATCH: a surface that holds the record and then renders only part
// of it. That is a design question a reader has to answer, not a string a scanner can find. This
// rule is about the shape of the plumbing, which is what actually decayed.
//
// Run: `pnpm run lint:failure-surface`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SWEPT = "apps/web/src";
const SKIP = new Set(["node_modules", "dist", "build", ".svelte-kit", "coverage"]);

/*
 * The legitimate homes, each for a stated reason:
 *   diagnostics/  — the presenter and the trace ARE the code that reads a problem apart; that is
 *                   their whole job, and it happens once for the whole app.
 *   paged-list    — its `failureMessage` getter is the shared list machine's own accessor, offered
 *                   beside the record rather than instead of it.
 *   document-presentation — a per-channel override that builds ON the shared presenter and returns
 *                   the whole guidance, not a bare string.
 */
const ALLOWED = [
  "apps/web/src/lib/diagnostics/",
  "apps/web/src/lib/matters/paged-list.svelte.ts",
  "apps/web/src/lib/documents/document-presentation.ts",
];

const FLATTENED_DETAIL = /\.problem\.detail\s*\?\?/;
const ERROR_ID_IN_STRING = /`[^`]*\$\{[^}]*\.problem\.errorId[^}]*\}[^`]*`/;

// Names bound to a failure RECORD in this file: `const x = $derived(y.failure)`, or a `$state`
// declared as one. Those are the values that render as "[object Object]".
const RECORD_BINDINGS = [
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\$derived\(\s*[\w.$]+\.failure\s*\)/g,
  /let\s+([A-Za-z_$][\w$]*)\s*=\s*\$state<\s*Failure\b/g,
];

/**
 * Every name in this component that holds a failure record. Read from the component's own script,
 * so the check is about what THIS file bound rather than what a name looks like.
 */
function failureRecordNames(source) {
  const names = new Set();
  for (const pattern of RECORD_BINDINGS) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

/**
 * Rendered as TEXT, rather than handed to a component.
 *
 * The distinction is POSITION, not formatting. `failure={name}` and the `{name}` prop shorthand both
 * sit INSIDE a tag; text sits in element content. Both can be alone on a line — the screens that
 * shipped this bug had the record on its own line inside an <Alert.Description>, which is exactly
 * what a prop shorthand looks like — so the check asks whether the last angle bracket before the
 * interpolation opened a tag or closed one.
 */
function rendersRecordAsText(markup, name) {
  const interpolation = new RegExp(`\\{\\s*${name}\\s*\\}`, "g");
  for (const match of markup.matchAll(interpolation)) {
    if (markup[match.index - 1] === "=") continue;
    const opened = markup.lastIndexOf("<", match.index);
    const closed = markup.lastIndexOf(">", match.index);
    // Inside a tag (an unclosed `<` is nearer than the last `>`) → a prop. Otherwise → content.
    if (opened > closed) continue;
    return true;
  }
  return false;
}

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|svelte)$/.test(entry)) out.push(path);
  }
  return out;
}

const problems = [];
for (const file of walk(join(ROOT, SWEPT))) {
  const relativePath = relative(ROOT, file).replaceAll("\\", "/");
  if (ALLOWED.some((prefix) => relativePath.startsWith(prefix))) continue;
  const source = readFileSync(file, "utf8");
  if (relativePath.endsWith(".svelte")) {
    const scriptEnd = source.indexOf("</script>");
    const markup = scriptEnd === -1 ? source : source.slice(scriptEnd + "</script>".length);
    for (const name of failureRecordNames(source)) {
      if (!rendersRecordAsText(markup, name)) continue;
      problems.push(
        `${relativePath} [record-as-text] \`{${name}}\` renders a failure RECORD as text — Svelte ` +
          'stringifies it, so the screen reads "[object Object]" and the Error ID, the remedy and ' +
          "the retry never reach the reader; hand the record to FailureNotice instead",
      );
    }
  }
  source.split("\n").forEach((line, index) => {
    const where = `${relativePath}:${index + 1}`;
    if (FLATTENED_DETAIL.test(line)) {
      problems.push(
        `${where} [flattened-problem] \`.problem.detail ??\` — hold the failure record and render ` +
          "it through FailureNotice or FailureScreen; where this surface wants its own words, pass " +
          "them with stated() so the Error ID and the remedy still reach the screen",
      );
    }
    if (ERROR_ID_IN_STRING.test(line)) {
      problems.push(
        `${where} [error-id-as-prose] the Error ID is being interpolated into a message — the ` +
          "failure band renders it as a copyable chip, so the message does not have to carry it",
      );
    }
  });
}

if (problems.length > 0) {
  console.error("A failure is being flattened before it reaches the screen:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\n${String(problems.length)} problem(s). The failure surface is ` +
      "apps/web/src/lib/diagnostics/ over the design system's failure-band / failure-state; the " +
      "standard it serves is docs/conventions/error-logging.md.",
  );
  process.exit(1);
}

console.log(
  "lint:failure-surface: every failure reaches a surface whole — no problem flattened to a " +
    "sentence at the catch site, and no Error ID smuggled into one.",
);
