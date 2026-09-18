/*
 * A modal says two things: what it DOES, and WHICH RECORD it does it to. This is the gate that
 * keeps both one shape.
 *
 * WHAT THIS EXISTS FOR. Every rule below was already written down before this scan existed — in the
 * shells' own prop documentation, and in the owner's rulings of 2026-09-08 (a panel does not explain
 * its own subject; a record a person quotes out loud carries a number; a record quoted out loud is
 * identified before it is saved). None of it held. Eighteen of fifty-four subtitles were paragraphs
 * about what a subsystem is for, four panels put a number and a sentence in one string behind three
 * different separators, five headings asked a question where the other forty-seven named an act, and
 * six capitalised an article the other fourteen left alone. A rule recorded in a ledger binds the
 * people who read the ledger; a rule with a gate binds the diff. This is the sibling of
 * tooling/lint-screen-headers, which does the same job for the line at the top of a SCREEN, and it
 * is built the same way: pure functions here, the filesystem in index.mjs, fixtures beside both.
 *
 * WHAT THE TYPE ALREADY DOES, THIS DOES NOT REPEAT. `subtitle` is `RecordSubject | Snippet` since
 * 2026-09-14, so a paragraph cannot be passed as a string at all and no rule here has to look for
 * one. What a type cannot see is what is INSIDE a fact, what a heading reads like, and whether a
 * panel holding a record's number bothered to show it. That is this scan's whole beat.
 *
 * Each rule is the narrowest form of its question that still bites:
 *
 *   heading-act        — an acting panel's heading NAMES AN ACT, in the imperative. A panel that
 *                        makes a record says "New <Noun>" instead (the create control's own ruling,
 *                        2026-09-03), and a reading panel names the thing it shows. So the rule
 *                        applies where an act is being asked for and nowhere else.
 *   heading-question   — no heading ends in a question mark. The heading names the act; the panel IS
 *                        the question, and its own kind is what makes it one.
 *   heading-case       — interior articles and short prepositions stay lower case.
 *   subject-not-prose  — no fact, and no line of a subtitle snippet, is sentence-shaped. The owner's
 *                        2026-09-08 ruling, enforced where it can still be broken.
 *   reference-shown    — a panel whose own source holds one of the platform's record numbers passes
 *                        it to the subtitle's reference. This is the traceability rule: a panel that
 *                        HAS the number and shows something else is the defect the ruling names.
 *   allowance          — every recorded allowance still describes a real violation, on
 *                        tooling/lint-one-ui's discipline: a list nobody re-reads is how a gate goes
 *                        quiet.
 */

/** The shells a modal is one of. Both take the same two lines, so both are read the same way. */
export const MODAL_SHELLS = ["ActionDialog", "RecordWindow"];

/**
 * The kinds that ask for an act. A reading panel asks for nothing, so its heading names the thing it
 * shows rather than a verb; `ActionDialog`'s own default is `form`, which is an acting kind.
 */
const READING_KIND = "reading";

/**
 * The verbs an act is named with — the product's own vocabulary for what a panel can ask.
 *
 * A closed set, and extending it is the point rather than the cost: a new act adds one word here, in
 * a reviewed edit, which is what stops a panel quietly titling itself with a noun and leaving the
 * reader to guess what pressing the commit will do. It is the same discipline
 * `@magna-carta/identifiers`' prefix table and the record window's header set are held to.
 */
export const ACT_VERBS = new Set([
  "add",
  "amend",
  "answer",
  "apply",
  "approve",
  "archive",
  "assign",
  "attach",
  "book",
  "cancel",
  "change",
  "close",
  "confirm",
  "continue",
  "delete",
  "describe",
  "detach",
  "discard",
  "draft",
  "edit",
  "file",
  "finalize",
  "fold",
  "invite",
  "issue",
  "join",
  "keep",
  "kick",
  "move",
  "open",
  "recategorize",
  "record",
  "reject",
  "relate",
  "remove",
  "report",
  "request",
  "restore",
  "retire",
  "review",
  "satisfy",
  "send",
  "set",
  "supersede",
  "transfer",
  "upload",
  "vacate",
  "void",
  "waive",
  "withdraw",
  "write",
]);

/**
 * The words that stay lower case inside a title. Articles, the coordinators, and the prepositions
 * short enough that capitalising one reads as a mistake rather than a choice.
 */
const LOWER_CASE_INSIDE_TITLE = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "nor",
  "of",
  "on",
  "onto",
  "or",
  "the",
  "to",
  "up",
  "with",
]);

/**
 * Blanks the script block and every comment so a scan never matches a mention inside prose or code.
 * It BLANKS rather than deletes — each stripped region keeps its length and its newlines — because
 * every offset reported here is turned back into a line number against the original file. Deleting
 * would slide later matches earlier and quietly misreport the line, which is worse than silence.
 * Same function, for the same reason, as tooling/lint-screen-headers' own.
 */
export function markupOf(source) {
  const blank = (text) => text.replace(/[^\n]/gu, " ");
  return source.replace(/<script[\s\S]*?<\/script>/gu, blank).replace(/<!--[\s\S]*?-->/gu, blank);
}

/** The script block alone, for the rules that ask what a file HOLDS rather than what it renders. */
export function scriptOf(source) {
  return [...source.matchAll(/<script[\s\S]*?<\/script>/gu)].map((match) => match[0]).join("\n");
}

/** The line a character offset falls on, 1-indexed, so a message is something somebody can click. */
export function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * Every modal opening tag in a file, as { shell, attributes, index }.
 *
 * The attribute run is read up to the tag's own `>`, which is why the pattern excludes `<` rather
 * than being lazy: a lazy match stops at the first `>` INSIDE an attribute value — and
 * `subtitle={{ reference: … }}` has none, but an arrow function in a handler does.
 */
export function modalTags(markup) {
  const tags = [];
  for (const shell of MODAL_SHELLS) {
    const opening = new RegExp(`<${shell}(\\s(?:[^<>]|>=)*?)?/?>`, "gu");
    for (const match of markup.matchAll(opening)) {
      tags.push({ shell, attributes: match[1] ?? "", index: match.index ?? 0 });
    }
  }
  return tags.sort((left, right) => left.index - right.index);
}

/** A literal string attribute's value, or null when absent or dynamic (`heading={…}`). */
export function literalAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`, "u"));
  return match === null ? null : match[1];
}

/** Whether the tag passes the attribute at all, in any form — `x=`, or the `{x}` shorthand. */
export function hasAttribute(attributes, name) {
  return (
    new RegExp(`\\b${name}\\s*=`, "u").test(attributes) ||
    new RegExp(`\\{\\s*${name}\\s*\\}`, "u").test(attributes)
  );
}

/**
 * Whether this tag asks for an act.
 *
 * `ActionDialog`'s `kind` defaults to `form`, and only `reading` asks for nothing. A `RecordWindow`
 * never asks for one in its heading whatever it offers in its bar: a record is READ and CHANGED
 * there, and its heading is the RECORD'S NAME — "Deposition preparation", "Invoice 2026-0147" — so
 * the verb rule would be asking the wrong question of every one of them.
 */
export function asksForAnAct({ shell, attributes }) {
  if (shell === "RecordWindow") return false;
  return literalAttribute(attributes, "kind") !== READING_KIND;
}

/**
 * Whether this heading is a panel that MAKES a record, which takes the create control's noun form
 * rather than a verb. The noun itself is the create control's business, not this scan's.
 */
export function makesARecord(heading) {
  return /^New\s+\S/u.test(heading);
}

/** Problems with one heading, given what kind of panel carries it. */
export function findHeadingProblems({ file, line, heading, acting }) {
  const problems = [];
  const trimmed = heading.trim();
  if (trimmed === "") return problems;

  if (trimmed.endsWith("?")) {
    problems.push({
      file,
      line,
      rule: "heading-question",
      message:
        `asks "${trimmed}". A heading NAMES the act — "Retire This Event Type", not "Retire This ` +
        'Event Type?" — and the panel is what makes it a question: a confirm or destructive kind ' +
        "takes the alertdialog role, traps the decision, and offers Cancel beside the commit. " +
        "Forty-seven headings already name their act and five asked; the question mark is what goes.",
    });
  }

  const words = trimmed.replace(/[?]$/u, "").split(/\s+/u);
  for (const [position, word] of words.entries()) {
    if (position === 0 || position === words.length - 1) continue;
    const bare = word.replace(/[^A-Za-z]/gu, "");
    if (bare === "") continue;
    if (!LOWER_CASE_INSIDE_TITLE.has(bare.toLowerCase())) continue;
    if (bare === bare.toLowerCase()) continue;
    problems.push({
      file,
      line,
      rule: "heading-case",
      message:
        `capitalises "${bare}" inside "${trimmed}". An article or a short preposition stays lower ` +
        'case in a title — "File a Copy", not "File A Copy". Fourteen headings already do and six ' +
        "did not, which is a split a reader sees and cannot explain.",
    });
  }

  if (acting && !makesARecord(trimmed)) {
    const first = words[0].replace(/[^A-Za-z]/gu, "").toLowerCase();
    if (first !== "" && !ACT_VERBS.has(first)) {
      problems.push({
        file,
        line,
        rule: "heading-act",
        message:
          `opens with "${words[0]}", which is not one of the verbs an act is named with. A panel ` +
          'that ASKS FOR SOMETHING says what pressing its commit will do — "Write Off a Balance" ' +
          '— a panel that MAKES a record says "New <Noun>", and a panel that asks for nothing is ' +
          '`kind="reading"` and names the thing it shows. If this really is a new act, add its ' +
          "verb to ACT_VERBS in tooling/lint-modal-headers/modal-headers.mjs — that is a one-line " +
          "reviewed edit, and it is what keeps a noun from quietly becoming a heading.",
      });
    }
  }
  return problems;
}

/**
 * Whether a run of text reads as a sentence about something rather than a fact about the subject.
 *
 * The judgement is deliberately narrow, on tooling/lint-screen-headers' reasoning: a shape that has
 * never once been a legitimate fact is reported, and everything else is left alone. A fact is short
 * and has no full stop — "this matter still owes $4,120.00", "she/her", "3 of 7 submitted". A
 * paragraph about a subsystem ends its sentence, and every one of the eighteen removed on
 * 2026-09-14 did. A short line ending in a full stop is still let through, because an abbreviation
 * ends in one too.
 */
export function readsAsASentence(text) {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  const words = trimmed.split(/\s+/u).length;
  if (words <= SENTENCE_WORD_FLOOR) return false;
  return /[.!]["'’]?$/u.test(trimmed) || / — | -- /u.test(trimmed);
}

/**
 * Below this, a line is too short to be a paragraph whatever its punctuation. Set where it is
 * because the shortest prose subtitle removed on 2026-09-14 ran to eleven words and the longest
 * legitimate fact to six.
 */
export const SENTENCE_WORD_FLOOR = 8;

/** The string literals a `subtitle` attribute carries inline, with the offset of each. */
export function subtitleLiterals(attributes, tagIndex) {
  const found = [];
  const subtitle = attributes.match(/\bsubtitle=\{([\s\S]*?)\}\s*(?:[a-zA-Z{/>]|$)/u);
  if (subtitle === null) return found;
  const body = subtitle[1];
  const offset = tagIndex + (subtitle.index ?? 0);
  for (const literal of body.matchAll(/"([^"]*)"|'([^']*)'|`([^`$]*)`/gu)) {
    found.push({ text: literal[1] ?? literal[2] ?? literal[3] ?? "", index: offset });
  }
  return found;
}

/**
 * The body of each `{#snippet subtitle()}…{/snippet}` in the markup, with its offset.
 *
 * Nesting is counted rather than matched lazily: a subtitle that holds an `{#if}` closes with a
 * `{/if}` of its own, and a lazy match would stop at the first one and read half a body.
 */
export function subtitleSnippets(markup) {
  const found = [];
  const opener = /\{#snippet subtitle\(\)\}/gu;
  for (const open of markup.matchAll(opener)) {
    const start = (open.index ?? 0) + open[0].length;
    let depth = 1;
    let cursor = start;
    const token = /\{#(?:if|each|await|key|snippet)\b|\{\/(?:if|each|await|key|snippet)\b/gu;
    token.lastIndex = start;
    let match;
    while ((match = token.exec(markup)) !== null) {
      depth += match[0].startsWith("{#") ? 1 : -1;
      cursor = match.index;
      if (depth === 0) break;
    }
    if (depth !== 0) continue;
    found.push({ body: markup.slice(start, cursor), index: open.index ?? 0 });
  }
  return found;
}

/** The plain text of a snippet body — markup stripped, interpolations blanked out. */
export function plainTextOf(body) {
  return body
    .replace(/\{[^{}]*\}/gu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// --- rule: the record's number reaches the line that names it ----------------------------------

/** The schema this scan reads the platform's record numbers out of. */
export const SCHEMA_SOURCE = "packages/database/src/per-firm-schema.ts";

/*
 * NUMBERS THAT ARE NOT A RECORD'S OWN REFERENCE. A `*_number` column is usually the number somebody
 * quotes about a record; these are the ones that are a number of something else — a telephone, a
 * vehicle, a parcel of land, a row in an import — or a counter the platform keeps for itself.
 *
 * The exclusions are named here rather than the inclusions being named, and that direction is the
 * whole design: a record kind that grows a number is picked up by this scan on the day its column
 * lands, and either it reaches the panels that act on that record or somebody writes down here why
 * it is not a reference. A hand-kept list of INCLUSIONS would simply go quiet instead.
 */
export const NOT_A_RECORD_REFERENCE = new Map([
  ["counterpartyNumber", "a telephone number — the other end of a call, not a record's own name"],
  ["nationalNumber", "the national part of a telephone number"],
  ["parcelNumber", "a parcel of land's assessor number, a fact about property the firm records"],
  ["plateNumber", "a vehicle's registration plate"],
  ["serialNumber", "a manufactured thing's serial, recorded as an asset's own fact"],
  ["vehicleIdentificationNumber", "a vehicle's VIN"],
  ["pronounVerbNumber", "grammatical number — singular or plural — not a count or a reference"],
  ["valueNumber", "a custom field's numeric VALUE, whatever the field happens to hold"],
  ["sourceRowNumber", "which row of an import file a record came from"],
  [
    "versionNumber",
    "which version of a file this is — a position in a history, not the file's name",
  ],
  ["caseNumber", "the COURT's number for a matter, which the court owns and the firm records"],
]);

/**
 * The record-number identifiers the schema declares, as the camelCase names a surface would hold.
 *
 * Read from the schema source rather than imported, so this scan stays a plain script with no build
 * step behind it — the same choice tooling/lint-screen-headers makes about the sidebar registry.
 */
export function recordNumberIdentifiers(schemaSource) {
  const found = new Map();
  for (const match of schemaSource.matchAll(/"([a-z][a-z0-9]*(?:_[a-z0-9]+)*_number)"/gu)) {
    const camel = match[1].replace(/_([a-z0-9])/gu, (_, letter) => letter.toUpperCase());
    const excluded = NOT_A_RECORD_REFERENCE.get(camel);
    if (excluded === undefined) found.set(camel, match[1]);
  }
  return found;
}

/**
 * Problems with the references a file holds but does not show.
 *
 * The question is asked of the FILE rather than of each tag, because a panel reads its number into a
 * value at the top and renders it at the bottom, and tying the two together by tag would need a
 * parser this does not have. What it asserts is the honest form of the rule: a file that renders a
 * modal and holds a record's number puts that number in a subtitle reference somewhere in it.
 */
export function findReferenceProblems({ file, source, markup, tags, identifiers }) {
  const problems = [];
  if (tags.length === 0) return problems;

  /*
   * IT ASKS THIS OF BOTH SHELLS. A record window names the record it is showing and an action
   * dialog names the record it is acting on; the question — was this panel handed a number it does
   * not state — is the same one, and a rule that skipped the windows would miss the surfaces where
   * a reader spends the most time.
   *
   * THE RULE FIRES ON A PROP, and that is what keeps it true rather than merely loud.
   *
   * A record number a surface was HANDED is that surface being told which record it is about; the
   * same identifier read off a row to build a picker's label, or named in a callback's type, is
   * not. An earlier draft asked whether the identifier appeared anywhere in the file at all and
   * reported five panels that were doing nothing wrong — a picker label, a guard condition, a
   * callback parameter — which is the shape of a gate people switch off.
   */
  const handed = propNames(source);

  /*
   * Where a number IS named: in the panel's own two lines. The subtitle is its home, and a heading
   * counts because a record whose NAME is its number says so there — a bill opens as "Invoice
   * 2026-0147" and repeating it below would be the same fact twice. The reference object is
   * recognised by its SHAPE, `{ kind: …, number: … }`, rather than by the name it is bound to: a
   * panel that needs the reference twice binds it to a name of its own, and a rule keyed on the
   * literal `reference:` label would miss every one of those.
   */
  const shown = new Set();
  /*
   * A prop is usually handed to the reference directly, and sometimes through ONE derived value: a
   * panel that can be opened on a matter or pick one answers `chosenMatter?.matterNumber ?? prop`
   * and names the result. So a name that a `$derived` computed FROM the prop counts as the prop for
   * this rule's purpose. One hop, deliberately: following a chain would need a parser, and a rule
   * that quietly resolved three hops would be one nobody could predict the verdict of.
   */
  const aliases = new Map();
  for (const derived of source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\$derived[\s\S]{0,600}?\n\s*\);?\n/gu,
  )) {
    for (const name of identifiers.keys()) {
      if (derived[0].includes(name)) aliases.set(derived[1], name);
    }
  }
  const named = (text) => {
    for (const name of identifiers.keys()) if (text.includes(name)) shown.add(name);
    for (const [alias, name] of aliases) if (text.includes(alias)) shown.add(name);
  };
  for (const object of source.matchAll(/\{[^{}]*\bkind:[^{}]*\bnumber:[^{}]*\}/gu))
    named(object[0]);
  for (const snippet of subtitleSnippets(markup)) named(snippet.body);
  for (const tag of tags) {
    const subtitle = tag.attributes.match(/\bsubtitle=\{([\s\S]*?)\}\s*(?:[a-zA-Z{/>]|$)/u);
    if (subtitle !== null) named(subtitle[1]);
    named(literalAttribute(tag.attributes, "heading") ?? "");
  }
  // A heading built in the script, which is how a record whose name IS its number states one.
  for (const heading of source.matchAll(/\bconst heading\s*=[\s\S]*?;\n/gu)) named(heading[0]);

  for (const [name, column] of identifiers) {
    if (shown.has(name) || !handed.has(name)) continue;
    const at = source.search(new RegExp(`\\b${name}\\b`, "u"));
    problems.push({
      file,
      line: lineOf(source, at === -1 ? 0 : at),
      rule: "reference-shown",
      message:
        `takes \`${name}\` (the schema's \`${column}\`) as a prop and names it in neither its ` +
        "heading nor its subtitle. Being handed a record's number is being told which record this " +
        "panel is about, and a record a person quotes out loud is named by that number rather than " +
        "by a handle — the owner's ruling of 2026-09-08. Put it in the subtitle's `reference`, or " +
        `record in NOT_A_RECORD_REFERENCE why \`${column}\` is not a record's own name.`,
    });
  }
  return problems;
}

/**
 * The names a component takes as props: the identifiers destructured out of `$props()`.
 *
 * Read from the destructuring pattern rather than the type block beside it, because the type block
 * also holds callback signatures whose own parameters are named for the values they carry — an
 * `onFinalized: (invoiceNumber: string) => void` is a panel REPORTING a number, not holding one.
 */
export function propNames(source) {
  const names = new Set();
  const block = source.match(/let\s*\{([\s\S]*?)\}\s*(?::[\s\S]*?)?=\s*\$props\(\)/u);
  if (block === null) return names;
  let depth = 0;
  let current = "";
  for (const character of block[1]) {
    if ("({[".includes(character)) depth += 1;
    else if (")}]".includes(character)) depth -= 1;
    if (character === "," && depth === 0) {
      const name = current.trim().match(/^([A-Za-z_$][\w$]*)/u);
      if (name !== null) names.add(name[1]);
      current = "";
    } else current += character;
  }
  const last = current.trim().match(/^([A-Za-z_$][\w$]*)/u);
  if (last !== null) names.add(last[1]);
  return names;
}

/**
 * The modals' two lines, audited. `files` is [{ path, source }]; `identifiers` is the schema's
 * record-number map; `allowances` is [{ rule, file, text, reason }].
 */
export function auditModalHeaders({ files, identifiers, allowances = [] }) {
  const problems = [];
  const allowed = new Set();
  let panelsSeen = 0;

  for (const { path: file, source } of files) {
    const markup = markupOf(source);
    const tags = modalTags(markup);
    if (tags.length === 0) continue;
    panelsSeen += tags.length;

    for (const tag of tags) {
      const line = lineOf(source, tag.index);
      const heading = literalAttribute(tag.attributes, "heading");
      if (heading !== null) {
        problems.push(
          ...findHeadingProblems({
            file,
            line,
            heading,
            acting: asksForAnAct(tag),
          }),
        );
      }

      for (const literal of subtitleLiterals(tag.attributes, tag.index)) {
        if (!readsAsASentence(literal.text)) continue;
        problems.push({
          file,
          line,
          rule: "subject-not-prose",
          message:
            `states "${literal.text}" as a fact about its subject. A fact is what the reader needs ` +
            "to know about the RECORD — what it still owes, when it happened, who it is — and a " +
            "sentence here is the panel explaining itself, which the heading has already done. " +
            "Move it beside the field it is about, or delete it. See " +
            'docs/conventions/design-corrections.md, "A panel does not explain its own subject".',
        });
      }
    }

    for (const snippet of subtitleSnippets(markup)) {
      const text = plainTextOf(snippet.body);
      if (!readsAsASentence(text)) continue;
      problems.push({
        file,
        line: lineOf(source, snippet.index),
        rule: "subject-not-prose",
        message:
          `states "${text}" under its heading. A subtitle names what is being acted on; it is not ` +
          "the place for a paragraph on what the subsystem is for. See " +
          'docs/conventions/design-corrections.md, "A panel does not explain its own subject".',
      });
    }

    problems.push(...findReferenceProblems({ file, source, markup, tags, identifiers }));
  }

  /*
   * The allowances, applied and then audited. An entry that no longer matches a problem is itself a
   * failure — the same discipline tooling/lint-one-ui holds its list to, and for the same reason: a
   * list that is never re-read is a gate that has gone quiet without anybody noticing.
   */
  const standing = [];
  const remaining = [];
  for (const problem of problems) {
    const match = allowances.find(
      (allowance) =>
        allowance.rule === problem.rule &&
        allowance.file === problem.file &&
        problem.message.includes(allowance.text),
    );
    if (match === undefined) remaining.push(problem);
    else {
      standing.push(problem);
      allowed.add(match);
    }
  }
  for (const allowance of allowances) {
    if (allowed.has(allowance)) continue;
    remaining.push({
      file: allowance.file,
      line: 0,
      rule: "allowance",
      message:
        `is allowed for \`${allowance.rule}\` ("${allowance.text}") and no longer violates it. ` +
        "Take the allowance out — an entry that has outlived its violation is how a list stops " +
        "being read.",
    });
  }

  return { problems: remaining, standing, panelsSeen };
}
