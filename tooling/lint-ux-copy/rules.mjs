// The patterns lint:ux-copy holds, and the line reading they run over. Kept apart from index.mjs so
// the fixture suite can exercise them without touching the filesystem.
//
// The rules come from docs/conventions/ux-copy.md. Only the ones a line scan can see without
// guessing are here; length, tone and word choice stay with a reviewer.

/** Each rule: a stable id (the baseline key), the pattern, and the house-style rule it enforces. */
export const RULES = [
  {
    id: "em-dash",
    pattern: /\u2014|&mdash;|\\u2014/,
    applies: (part) => isProse(part),
    why: "No em dashes in UI copy. Split the sentence instead.",
  },
  {
    id: "nothing-answered",
    pattern: /\bnothing answered\b|\bdid not answer\b|\bdidn't answer\b/i,
    why: 'A failed connection reads "Couldn\'t connect." then what to do.',
  },
  {
    id: "is-where",
    pattern: /\b(?:is|are) (?:where|who) (?:the|a|an|it|they|this|that|your)\b/i,
    why: 'No "is where / is who" sentences. Write the plain statement.',
  },
  {
    id: "machinery",
    pattern: /\bthe platform\b|\bcorpus\b|\bcorpora\b/i,
    why: 'Leave the machinery out. Say "Magna Carta" or "review set".',
  },
  {
    id: "old-soon-wording",
    pattern: /\bNot built yet\. Waiting on\b|\bis not served yet\b/,
    why: 'A Soon hover reads "Not built yet: <what is missing>."',
  },
];

const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/**
 * The parts of one source line a person could read: string literals on a script line, and on a
 * markup line the text between tags plus quoted attribute values. Comments, identifiers and
 * expressions are dropped, so a variable called `corpus` or a comment with a dash never counts.
 */
export function readableParts(line, inMarkup) {
  const trimmed = line.trim();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("<!--")
  ) {
    return [];
  }
  const withoutTrailingComment = line.replace(/\s\/\/\s.*$/, "").replace(/<!--.*?-->/g, "");
  const parts = [...withoutTrailingComment.matchAll(QUOTED)].map((match) => match[0].slice(1, -1));
  if (inMarkup) {
    const text = withoutTrailingComment
      .replace(QUOTED, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/^[^<]*>/, " ")
      .replace(/<[^>]*$/, " ");
    if (text.trim().length > 0) parts.push(text);
  }
  return parts;
}

/** Which rules a file breaks, and how often, given its text and whether it is a Svelte file. */
export function countViolations(source, isSvelte) {
  const counts = {};
  for (const found of findViolations(source, isSvelte))
    counts[found.rule] = (counts[found.rule] ?? 0) + 1;
  return counts;
}

/** Every violation in a file, with its line number and the text that broke the rule. */
export function findViolations(source, isSvelte) {
  const found = [];
  let lineNumber = 0;
  let inScript = false;
  let inStyle = false;
  let inBlockComment = false;
  for (const line of source.split("\n")) {
    lineNumber += 1;
    if (inBlockComment) {
      if (line.includes("*/") || line.includes("-->")) inBlockComment = false;
      continue;
    }
    const trimmed = line.trim();
    if (
      (trimmed.startsWith("/*") && !trimmed.includes("*/")) ||
      (trimmed.startsWith("<!--") && !trimmed.includes("-->"))
    ) {
      inBlockComment = true;
      continue;
    }
    if (isSvelte) {
      if (/^<script\b/.test(trimmed)) inScript = true;
      if (/^<style\b/.test(trimmed)) inStyle = true;
      if (trimmed.startsWith("</style>")) {
        inStyle = false;
        continue;
      }
      if (trimmed.startsWith("<\/script>")) {
        inScript = false;
        continue;
      }
      if (inStyle) continue;
    }
    const parts = readableParts(line, isSvelte && !inScript);
    for (const part of parts) {
      for (const rule of RULES) {
        if (rule.applies !== undefined && !rule.applies(part)) continue;
        const matches = part.match(new RegExp(rule.pattern.source, rule.pattern.flags + "g"));
        for (const _ of matches ?? [])
          found.push({ line: lineNumber, rule: rule.id, text: part.trim() });
      }
    }
  }
  return found;
}

/** Prose: at least five words of letters. A lone dash in an empty cell or a "number - title" join is not prose. */
function isProse(part) {
  return (part.match(/[A-Za-z]{2,}/g) ?? []).length >= 5;
}

/**
 * Compare this run's counts with the baseline. The total for each rule may not rise; copy that moves
 * from one file to another (a screen split in two, a component extracted) keeps the total and passes.
 * `rose` names each rule whose total went up, with the files whose own count went up as the likely
 * cause. `fell` names each file whose count went down, so the baseline can be tightened.
 */
export function compareWithBaseline(current, baseline) {
  const rose = [];
  const fell = [];
  const files = [...new Set([...Object.keys(current), ...Object.keys(baseline)])].sort();
  for (const rule of RULES) {
    const total = (counts) =>
      Object.values(counts).reduce((sum, rules) => sum + (rules[rule.id] ?? 0), 0);
    const now = total(current);
    const was = total(baseline);
    const grew = files.filter(
      (file) => (current[file]?.[rule.id] ?? 0) > (baseline[file]?.[rule.id] ?? 0),
    );
    if (now > was) rose.push({ rule: rule.id, was, now, files: grew });
    for (const file of files) {
      const a = current[file]?.[rule.id] ?? 0;
      const b = baseline[file]?.[rule.id] ?? 0;
      if (a < b) fell.push({ file, rule: rule.id, was: b, now: a });
    }
  }
  return { rose, fell };
}
