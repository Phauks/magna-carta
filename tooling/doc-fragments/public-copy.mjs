// The rules published copy has to hold, as a pure check over one string. Used by
// tooling/lint-roadmap.mjs on every `audience: public` ledger node; unit-tested in
// public-copy.test.mjs.
//
// Each rule is a standard this repository already keeps somewhere else, applied at the one place a
// public roadmap could break it. The process-reference ban and the no-shorthand rule are golden
// rules and are enforced in source by tooling/lint-process-references.mjs; the emoji ban is a golden
// rule enforced on changelog fragments; the no-dates posture is the public roadmap's own, and is the
// reason there is no date field to fill in — a sentence is the only remaining place a quarter could
// get promised, so it is checked here.
//
// The rules are deliberately blunt and the failure message says what to write instead. A false
// positive costs one reworded sentence; a false negative is a published document that reads like an
// internal tracker, which is the exact thing the public view exists not to be.

import { containsEmoji } from "./changelog.mjs";

const RULES = [
  {
    pattern: /\bADR-\d/i,
    problem: "names a decision record — say what the product does, not how it was decided",
  },
  {
    pattern: /\b(slice|phase)\s*[0-9]/i,
    problem:
      "names an internal slice or phase number, which outside this repository reads as a schedule",
  },
  {
    pattern: /§/,
    problem: "cites a document section",
  },
  {
    pattern: /(docs\/|\.md\b|packages\/|crates\/|apps\/)/,
    problem: "names a file or directory in this repository",
  },
  {
    pattern: /@magna-carta\//,
    problem: "names an internal package",
  },
  {
    pattern: /\b(19|20)\d{2}\b|\bQ[1-4]\b/,
    problem:
      "carries a year or a quarter — this roadmap states no dates, because a date is a promise made before the work is understood",
  },
];

export function publicCopyProblems(text, field) {
  const problems = [];
  if (typeof text !== "string" || text.trim() === "") {
    return [`${field} is empty`];
  }
  if (text !== text.trim()) problems.push(`${field} has leading or trailing whitespace`);
  if (containsEmoji(text)) problems.push(`${field} contains an emoji`);

  for (const rule of RULES) {
    if (rule.pattern.test(text)) problems.push(`${field} ${rule.problem}: "${text}"`);
  }

  if (field === "public-summary") {
    // One sentence, punctuated. The published page sets these as prose beside each other, and a list
    // where some lines stop and some trail off reads as unfinished rather than as terse.
    if (!/[.?!]$/.test(text.trim()))
      problems.push(`${field} does not end in a full stop: "${text}"`);
    if (text.length > 240) {
      problems.push(
        `${field} is ${text.length} characters — keep it to one sentence a reader scans`,
      );
    }
  }
  if (field === "public-name" && text.length > 60) {
    problems.push(`${field} is ${text.length} characters — it is a name, not a description`);
  }
  return problems;
}
