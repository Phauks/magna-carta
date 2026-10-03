// @repo-wide-fitness — walks every first-party source tree from the repository root for the modules
// that reach a transcript's words, so the diff that adds a logger call to one of them is by definition
// not a diff in this package.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// NO TRANSCRIPT TEXT REACHES A LOGGER, AN AUDIT ROW OR AN ERROR.
//
// A transcript is what was said in a privileged conversation, attributed to the person who said it.
// The record holds it in two places — the segment rows and the filed document — and the read route
// serves it; everything else that touches a transcript (the consumer driving the model, the sweep, the
// statements, the route's audit) is supposed to carry handles, counts and fixed sentences only. That
// was a rule kept by review. This scan keeps it by reading the source: every module that reaches the
// words is found by what it imports or names, and in each one, every call to a SINK — the standard
// failure pipeline, a logger, an audit builder, an Error, a problem body — is read for an argument that
// names the words, a speaker's name, the prompt the model was sent, the document's name or bytes.
//
// It runs in the node pool rather than beside the Worker's suites because the Worker's suites run
// inside the Workers runtime and cannot read the repository's files.
//
// What it cannot see: text passed to a sink through a variable whose name says nothing (`const x =
// row.text; logger.info(x)`). The forbidden names are the ones the code base actually uses for the
// words, so the scan holds the ordinary shape of the mistake; a name chosen to hide the words is a
// review question, and so is a new sink, which belongs in `SINKS` below.

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

/** Every first-party source tree: each app's and each package's `src`. */
function sourceRoots(): string[] {
  const roots: string[] = [];
  for (const parent of ["apps", "packages"]) {
    const directory = join(repositoryRoot, parent);
    for (const name of readdirSync(directory)) {
      const source = join(directory, name, "src");
      try {
        if (statSync(source).isDirectory()) roots.push(source);
      } catch {
        // A workspace member with no source tree has nothing to scan.
      }
    }
  }
  return roots;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (
      name === "node_modules" ||
      name === "pkg" ||
      name === ".tsbuild" ||
      name === ".svelte-kit"
    ) {
      return [];
    }
    const full = join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:ts|svelte)$/u.test(name) && !name.endsWith(".gen.ts") ? [full] : [];
  });
}

/**
 * WHAT MAKES A MODULE ONE THAT REACHES THE WORDS: it imports the transcript's statements, types,
 * service or assembly, or the document's renderer; it calls the speech model; or it names the
 * transcript's own shapes.
 */
const REACHES_TRANSCRIPT_TEXT = [
  /@magna-carta\/meetings\/transcript-/u,
  /@magna-carta\/meetings\/webvtt/u,
  /\.\/transcript-(?:statements|service|assembly|types)\.ts/u,
  /\.\/webvtt\.ts/u,
  /\.transcribe\(/u,
  /\bTranscriptionResult\b/u,
  /\bMeetingTranscript(?:Segment|Page|Message)\b/u,
];

/** The calls that carry a value somewhere a person other than the firm's reader may see it. */
const SINKS = [
  /\brecordRealtimeFailure\(/gu,
  /\blogOperationFailed\(/gu,
  /\blogger\.\w+\(/gu,
  /\bconsole\.\w+\(/gu,
  /\bdomainAuditStatement\(/gu,
  /\binsertAuditLogStatement\(/gu,
  /\bfileAuditStatement\(/gu,
  /\bnew \w*Error\(/gu,
  /\bintegrationProblem\(/gu,
  /\bproblemJson\(/gu,
];

/** The names the code base uses for the words, who said them, and what the model was sent. */
const FORBIDDEN_IN_A_SINK = [
  /\.text\b/u,
  /\btext\s*[,}]/u,
  /\bdisplay_?[nN]ame\b/u,
  /\bspeakerName\b/u,
  /\bconfirmed_name\b/u,
  /\binitialPrompt\b/u,
  /\bpromptTail\b/u,
  /\bdocument\.bytes\b/u,
  /\brenderWebVtt\b/u,
  /\bfacts\.title\b/u,
  /\bFileName\(/u,
];

/** Source with comments removed, so a comment describing the rule is not read as breaking it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
}

/** The text of every call to a sink: from the sink's name to its matching close parenthesis. */
function sinkCalls(source: string): string[] {
  const calls: string[] = [];
  for (const sink of SINKS) {
    sink.lastIndex = 0;
    for (let match = sink.exec(source); match !== null; match = sink.exec(source)) {
      let depth = 0;
      let end = match.index + match[0].length - 1;
      for (; end < source.length; end += 1) {
        const character = source[end];
        if (character === "(") depth += 1;
        else if (character === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      calls.push(source.slice(match.index, end + 1));
    }
  }
  return calls;
}

/** Every sink call in one source that names the words, with the name it used. */
function textEscapes(source: string): { readonly call: string; readonly names: string }[] {
  const escapes: { call: string; names: string }[] = [];
  for (const call of sinkCalls(withoutComments(source))) {
    const forbidden = FORBIDDEN_IN_A_SINK.find((pattern) => pattern.test(call));
    if (forbidden !== undefined) escapes.push({ call, names: forbidden.source });
  }
  return escapes;
}

function modulesReachingTranscriptText(): string[] {
  return sourceRoots()
    .flatMap(sourceFiles)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return REACHES_TRANSCRIPT_TEXT.some((pattern) => pattern.test(source));
    });
}

describe("no transcript text reaches a logger, an audit row or an error (fitness)", () => {
  const modules = modulesReachingTranscriptText().map((file) => ({
    file,
    name: relative(repositoryRoot, file).replaceAll("\\", "/"),
  }));

  it("actually finds the modules that reach the words", () => {
    const names = modules.map((module) => module.name);
    // The consumer that drives the model, the sweep, the read route and the statements and service
    // that hold the words: if any of these stopped being found, the scan would pass by looking at
    // nothing.
    for (const expected of [
      "apps/api-worker/src/meetings/transcript-consumer.ts",
      "apps/api-worker/src/meetings/recording-sweep.ts",
      "apps/api-worker/src/routes/meetings.ts",
      "packages/meetings/src/transcript-service.ts",
      "packages/meetings/src/transcript-statements.ts",
      "packages/meetings/src/webvtt.ts",
      "packages/inference/src/gateway.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("finds a sink call that names the words — the scan is not vacuous", () => {
    expect(
      textEscapes(
        `recordRealtimeFailure(logger, "x", new Error(\`refused: \${answer.value.text}\`));\n` +
          `domainAuditStatement(database, { metadata: { speaker: row.display_name } });\n` +
          `logger.info({ prompt: input.initialPrompt });`,
      ).map((escape) => escape.names),
      // A sink nested in another (an Error inside the failure pipeline's call) reports the name twice.
    ).toEqual(
      expect.arrayContaining(["\\.text\\b", "\\bdisplay_?[nN]ame\\b", "\\binitialPrompt\\b"]),
    );
    // A handle, a count, a category and a fixed sentence are what a sink may carry.
    expect(
      textEscapes(
        `recordRealtimeFailure(logger, "x", new Error(\`refused (\${answer.problem.category})\`));\n` +
          `// a comment naming row.text is not a call\n` +
          `domainAuditStatement(database, { metadata: { lineCount: rows.length } });`,
      ),
    ).toEqual([]);
  });

  it("no module that reaches a transcript's words passes them to a sink", () => {
    for (const module of modules) {
      const escapes = textEscapes(readFileSync(module.file, "utf8"));
      expect(
        escapes,
        `${module.name} passes ${escapes.map((escape) => `"${escape.names}"`).join(", ")} to a sink`,
      ).toEqual([]);
    }
  });
});
