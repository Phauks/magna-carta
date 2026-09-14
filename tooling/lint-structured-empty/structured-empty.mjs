/*
 * Fitness function: where data will arrive, the structure that will hold it renders first, empty.
 *
 * THE RULING (2026-09-14). "Places where data will populate and it should be in the table, but it
 * is just loose on the background or the screen. This doesn't prepare the user for incoming
 * information, and makes it more difficult to identify issues." A table renders its header row and
 * its empty body; a definition list renders its terms with empty definitions; a rail renders its
 * frame. The words that explain the emptiness live INSIDE that structure's own empty state — the
 * design system's EmptyState in DataTable.Grid's `empty` snippet, EventRail's `emptyMessage`, the
 * list's own empty row — never as loose prose beside or beneath it on the canvas.
 *
 * THE TWO SHAPES THIS CATCHES are the two the owner pointed at:
 *
 *   1. `loose-empty-branch` — a conditional with a structure in one branch and a paragraph in
 *      another: `{#if rows.length === 0}<p>…</p>{:else}<DataTable.Grid …/>{/if}`, and its `{#each}`
 *      and `{#await}` cousins. The paragraph stands where the structure would, so the structure
 *      never shows its frame until the data is there.
 *
 *   2. `prose-after-structure` — a muted paragraph immediately after a structure's closing tag in
 *      the same block (the messaging History tab: an EventRail and then a paragraph of explanation
 *      beneath it, on the canvas). Words about the structure belong inside it.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH, stated plainly, because a lint that cries wolf gets deleted:
 *
 *   - A branch that renders a COMPONENT in place of a structure (`{:else}<EmptyState …/>`). That is
 *     a design question the ledger answers — the words are at least in the product's one empty
 *     state — and reading it here would turn every permission refusal and every FailureNotice into
 *     a finding.
 *   - Prose BEFORE a structure, or prose after a structure that carries no muted tone. A heading
 *     line, a figures strip, a plain sentence stating a fact of the result: none of these is the
 *     shape the owner named, and a rule wide enough to catch them would catch every caption.
 *   - A branch whose condition is not about absence. `{#if section.kind === "text"}<p>` beside a
 *     `{:else if section.kind === "fields"}<dl>` is a discriminated union, not an empty state, and
 *     `{#if dev}…{:else}<p>only in development</p>` replaces a whole page rather than a
 *     structure. The rule reads the prose branch's own condition (or, for a bare `{:else}`, the
 *     chain's) for the words absence is written in — `length`, `null`, `loading`, `=== 0` and
 *     their kin — and fires only then. An `{#each}`'s `{:else}` is absence by definition.
 *   - A paragraph holding only a non-breaking space. That is a spacer keeping a pane's height,
 *     not a sentence, and the pane beside it is stating why.
 *   - Prose inside a structure's own body (a `<p>` inside a `<dl>`'s `{:else}`). It is inside the
 *     frame; whether it is the RIGHT empty state is review's call.
 *   - A structure assembled in a module, or a prose element whose tag arrives from a variable.
 *     Every rule here reads markup, not behaviour.
 *   - Stories. They demonstrate, and the demonstration is the point.
 *
 * AN ALLOWANCE is an HTML comment placed immediately before the element the scan would report:
 * `<!-- structured-empty-allow: <why this is prose and not a structure's empty state> -->`. It
 * carries its reason beside the code it excuses, an allowance with no reason is itself a finding,
 * and an allowance that excuses nothing is a finding too — the list cannot fill up with entries
 * nobody re-reads.
 *
 * Run: `pnpm run lint:structured-empty`.
 */

/**
 * The structures that hold data, and where each one's words about emptiness belong. The key is
 * the tag as written in markup; `DataTable.` is matched as a prefix because every part of the one
 * table is the table.
 */
export const STRUCTURES = new Map([
  [
    "DataTable.",
    "the table's own empty body — DataTable.Grid renders its header row over an empty body on its " +
      "own, and takes an `empty` snippet (EmptyState) for the words",
  ],
  ["table", "the table's own empty body, under its header row"],
  [
    "dl",
    "the definition list's own frame — its terms stand with empty definitions, and the words go " +
      "in the list's empty row",
  ],
  ["EventRail", "the rail's `emptyMessage`, which renders inside the rail's frame"],
  ["Conversation", "the conversation's own empty state, inside its frame"],
  ["FolderTree", "the tree's `emptyMessage`, which renders inside the tree's frame"],
  ["RecordParties", "the component's own EmptyState, which it renders inside its frame"],
  ["RecordAttachments", "the component's own EmptyState, which it renders inside its frame"],
]);

/** The elements that are prose when they hold only text. */
const PROSE_TAGS = new Set(["p", "div", "section", "span", "small", "em", "strong", "i", "b"]);

/** Elements HTML closes on its own; the parser must not wait for a closing tag that never comes. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** The tones a paragraph beneath a structure wears when it is explaining the structure. */
const MUTED_TONE = /\btext-text-(?:muted|subtle)\b/;

export const ALLOWANCE = /<!--\s*structured-empty-allow:([^]*?)-->/g;

/**
 * Blank a run of text to spaces, keeping its newlines, so a reported line number still points at
 * the line the reader has to look at. Every stripper here works this way.
 */
const blank = (text) => text.replaceAll(/[^\n]/g, " ");

/** The markup of a Svelte file: script and style blocks and comments blanked, offsets preserved. */
export function markupOf(source) {
  return source
    .replaceAll(/<script\b[^>]*>[^]*?<\/script>/g, blank)
    .replaceAll(/<style\b[^>]*>[^]*?<\/style>/g, blank)
    .replaceAll(/<!--[^]*?-->/g, blank);
}

/** The 1-based line a character index falls on. */
export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * The name a structure is registered under, or null. `DataTable.Grid`, `DataTable.Root` and every
 * other part of the one table answer to the `DataTable.` prefix.
 */
export function structureNameOf(tagName) {
  for (const key of STRUCTURES.keys()) {
    if (key.endsWith(".") ? tagName.startsWith(key) : tagName === key) return key;
  }
  return null;
}

// --- the markup parser -------------------------------------------------------------------------

/**
 * Where a `{` expression ends, honouring nested braces and the quotes inside them. A block tag's
 * expression (`{#if rows.filter((row) => row.kind === "x").length === 0}`) can hold anything an
 * expression can, so this is a small scanner rather than a regex.
 */
function expressionEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Where an open tag ends. Attributes can hold `>` inside a quoted value or an expression, so the
 * scan tracks both rather than looking for the first `>`.
 */
function tagEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      const end = expressionEnd(text, index);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

const TAG_NAME = /^[A-Za-z][\w.:-]*/;

/**
 * Parse Svelte markup into a tree of elements, text and blocks. Blocks carry their branches, each
 * branch its children, so a rule can ask what one branch renders against what another does.
 *
 * It is a lenient parser: a mismatched closing tag is skipped, an unterminated construct ends the
 * scan. The design-system and app files it reads are compiled by Svelte first, so anything it
 * cannot follow is already a build error somewhere else.
 */
export function parseMarkup(text) {
  const root = { type: "root", start: 0, end: text.length, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const append = (node) => top().children.push(node);
  let index = 0;

  const flushText = (from, to) => {
    if (to > from) append({ type: "text", start: from, end: to, value: text.slice(from, to) });
  };

  /** Pop the stack back to (and including) the innermost branch whose block has the given kind. */
  const closeBlock = (kind, end) => {
    for (let depth = stack.length - 1; depth > 0; depth -= 1) {
      const item = stack[depth];
      if (item.type === "branch" && item.block.kind === kind) {
        item.block.end = end;
        stack.length = depth;
        return true;
      }
    }
    return false;
  };

  while (index < text.length) {
    const character = text[index];

    if (character === "<") {
      if (text.startsWith("</", index)) {
        const close = text.indexOf(">", index);
        if (close === -1) break;
        const name = text.slice(index + 2, close).trim();
        for (let depth = stack.length - 1; depth > 0; depth -= 1) {
          const item = stack[depth];
          if (item.type === "branch") break; // a tag never closes across a block boundary
          if (item.type === "element" && item.name === name) {
            item.end = close + 1;
            stack.length = depth;
            break;
          }
        }
        index = close + 1;
        continue;
      }
      const nameMatch = TAG_NAME.exec(text.slice(index + 1));
      if (nameMatch !== null) {
        const name = nameMatch[0];
        const end = tagEnd(text, index + 1 + name.length);
        if (end === -1) break;
        const selfClosing = text[end - 1] === "/" || VOID_TAGS.has(name.toLowerCase());
        const element = {
          type: "element",
          name,
          attributes: text.slice(index + 1 + name.length, selfClosing ? end - 1 : end),
          selfClosing,
          start: index,
          end: end + 1,
          children: [],
        };
        append(element);
        if (!selfClosing) stack.push(element);
        index = end + 1;
        continue;
      }
      flushText(index, index + 1);
      index += 1;
      continue;
    }

    if (character === "{") {
      const end = expressionEnd(text, index);
      if (end === -1) break;
      const body = text.slice(index + 1, end).trim();
      const lead = body[0];
      if (lead === "#") {
        const kind = /^#(\w+)/.exec(body)?.[1] ?? "";
        const block = { type: "block", kind, start: index, end: end + 1, branches: [] };
        const branch = {
          type: "branch",
          label: kind,
          condition: body.slice(kind.length + 1).trim(),
          block,
          start: index,
          children: [],
        };
        block.branches.push(branch);
        append(block);
        stack.push(branch);
      } else if (lead === ":") {
        const label = /^:(\w+(?:\s+\w+)?)/.exec(body)?.[1] ?? "";
        // Pop any element left open inside the branch (a build error elsewhere), then swap branches.
        while (stack.length > 1 && top().type !== "branch") stack.pop();
        const current = top();
        if (current.type === "branch") {
          stack.pop();
          const branch = {
            type: "branch",
            label,
            condition: body.slice(label.length + 1).trim(),
            block: current.block,
            start: index,
            children: [],
          };
          current.block.branches.push(branch);
          stack.push(branch);
        }
      } else if (lead === "/") {
        const kind = /^\/(\w+)/.exec(body)?.[1] ?? "";
        closeBlock(kind, end + 1);
      } else if (lead === "@") {
        const kind = /^@(\w+)/.exec(body)?.[1] ?? "";
        append({ type: "directive", kind, start: index, end: end + 1 });
      } else {
        append({ type: "text", start: index, end: end + 1, value: text.slice(index, end + 1) });
      }
      index = end + 1;
      continue;
    }

    let next = index + 1;
    while (next < text.length && text[next] !== "<" && text[next] !== "{") next += 1;
    flushText(index, next);
    index = next;
  }

  return root;
}

// --- what a branch renders -----------------------------------------------------------------

/** Nodes that render nothing a reader sees, and so do not count when a branch is weighed. */
function isInsignificant(node) {
  if (node.type === "text") return node.value.trim() === "";
  if (node.type === "directive") return node.kind === "const" || node.kind === "debug";
  return false;
}

export function significantChildren(nodes) {
  return nodes.filter((node) => !isInsignificant(node));
}

/** Every structure element under these nodes, through elements and nested blocks alike. */
export function structuresUnder(nodes, found = []) {
  for (const node of nodes) {
    if (node.type === "element") {
      if (structureNameOf(node.name) !== null) found.push(node);
      structuresUnder(node.children, found);
    } else if (node.type === "block") {
      for (const branch of node.branches) structuresUnder(branch.children, found);
    }
  }
  return found;
}

/** True when a node is text, or a prose element holding nothing but text and other prose. */
function isProse(node) {
  if (node.type === "text") return true;
  if (node.type !== "element") return false;
  if (!PROSE_TAGS.has(node.name)) return false;
  return node.children.every((child) => isInsignificant(child) || isProse(child));
}

/** A non-breaking space, in the forms markup writes it. A paragraph of these is a spacer. */
const BLANK_ENTITY = /&(?:nbsp|#160|#xa0);/gi;

/** True when a node holds text a reader would read, somewhere beneath it. */
function carriesWords(node) {
  if (node.type === "text") return node.value.replaceAll(BLANK_ENTITY, "").trim() !== "";
  if (node.type !== "element") return false;
  return node.children.some(carriesWords);
}

/**
 * True when these nodes are loose prose: at least one thing rendered, everything rendered is text
 * or a prose element, and somewhere in it there are words.
 */
export function isLooseProse(nodes) {
  const significant = significantChildren(nodes);
  if (significant.length === 0) return false;
  return significant.every(isProse) && significant.some(carriesWords);
}

/**
 * The words a condition is written in when it tests for data that has not arrived: a count, a
 * null, a read in flight, a failure. A branch whose condition says none of these — a kind, a
 * mode, a build flag — is a different case, not the empty one, and stays out of the rule.
 */
const ABSENCE =
  /\b(?:length|size|count|null|undefined|loading|reading|pending|empty|failed|failure|none|nothing|missing|absent|has[A-Z]\w*|is[A-Z]\w*)\b|(?:===?|!==?|[<>]=?)\s*0\b|!\w/;

/** True when a branch stands in for data that has not arrived, read off its own condition. */
export function standsInForAbsence(branch) {
  const { block } = branch;
  if (block.kind === "each") return branch.label === "else";
  if (block.kind === "await") return branch.label !== "then";
  if (branch.condition !== "") return ABSENCE.test(branch.condition);
  // A bare `{:else}` inherits the chain: it is the empty case only if the chain asks about absence.
  return block.branches.some((other) => other.condition !== "" && ABSENCE.test(other.condition));
}

// --- the rules -------------------------------------------------------------------------------

function describe(structures) {
  const names = [...new Set(structures.map((element) => element.name))];
  const homes = [
    ...new Set(structures.map((element) => STRUCTURES.get(structureNameOf(element.name)))),
  ];
  return { names: names.join(", "), homes: homes.join("; ") };
}

/** Walk every container (root, element, branch) in the tree. */
function containers(node, found = []) {
  if (node.type === "root" || node.type === "element") {
    found.push(node);
    for (const child of node.children) containers(child, found);
  } else if (node.type === "branch") {
    found.push(node);
    for (const child of node.children) containers(child, found);
  } else if (node.type === "block") {
    for (const branch of node.branches) containers(branch, found);
  }
  return found;
}

/** Every block in the tree, in document order. */
function blocks(node, found = []) {
  const children =
    node.type === "block" ? node.branches.flatMap((branch) => branch.children) : node.children;
  if (node.type === "block") found.push(node);
  for (const child of children ?? []) blocks(child, found);
  return found;
}

/**
 * Rule 1: a conditional whose one branch renders a structure and whose other branch is loose
 * prose standing where the structure would.
 */
export function findLooseEmptyBranches(tree) {
  const problems = [];
  for (const block of blocks(tree)) {
    if (!["if", "each", "await"].includes(block.kind)) continue;
    if (block.branches.length < 2) continue;
    const withStructure = block.branches
      .map((branch) => ({ branch, structures: structuresUnder(branch.children) }))
      .filter(({ structures }) => structures.length > 0);
    if (withStructure.length === 0) continue;
    const structures = withStructure.flatMap(({ structures: found }) => found);
    for (const branch of block.branches) {
      if (structuresUnder(branch.children).length > 0) continue;
      if (!isLooseProse(branch.children)) continue;
      if (!standsInForAbsence(branch)) continue;
      const first = significantChildren(branch.children)[0];
      const { names, homes } = describe(structures);
      problems.push({
        rule: "loose-empty-branch",
        index: first.start,
        detail:
          `prose stands in the \`{${branch.label}}\` branch where the other branch renders ${names}. ` +
          "Where data will arrive, the structure that will hold it renders first, empty, and the " +
          `words about the emptiness go inside it: ${homes}`,
      });
    }
  }
  return problems;
}

/**
 * Rule 2: a muted paragraph immediately after a structure's closing tag, in the same block. The
 * reader gets the structure and then, loose beneath it on the canvas, the explanation.
 */
export function findProseAfterStructures(tree) {
  const problems = [];
  for (const container of containers(tree)) {
    const children = significantChildren(container.children);
    for (let position = 0; position < children.length - 1; position += 1) {
      const node = children[position];
      if (node.type !== "element" || structureNameOf(node.name) === null) continue;
      const next = children[position + 1];
      if (next.type !== "element" || next.name !== "p") continue;
      if (!MUTED_TONE.test(next.attributes)) continue;
      const { homes } = describe([node]);
      problems.push({
        rule: "prose-after-structure",
        index: next.start,
        detail:
          `a muted paragraph follows ${node.name} on the canvas. Words about a structure belong ` +
          `inside it: ${homes}`,
      });
    }
  }
  return problems;
}

// --- allowances ------------------------------------------------------------------------------

/**
 * The allowance comments in a file, each with the index of the first thing after it — which is
 * the element it excuses.
 */
export function allowancesIn(source) {
  const found = [];
  for (const match of source.matchAll(ALLOWANCE)) {
    const commentEnd = match.index + match[0].length;
    let excuses = commentEnd;
    while (excuses < source.length && /\s/.test(source[excuses])) excuses += 1;
    found.push({ index: match.index, excuses, reason: match[1].trim() });
  }
  return found;
}

/**
 * Apply the allowances to the findings. An allowance with no reason, or one that excuses nothing,
 * is itself a finding — the same discipline the one-ui registry keeps.
 */
export function applyAllowances(problems, allowances) {
  const remaining = [];
  const excused = [];
  const used = new Set();
  for (const problem of problems) {
    const allowance = allowances.find((candidate) => candidate.excuses === problem.index);
    if (allowance === undefined || allowance.reason === "") {
      remaining.push(problem);
      continue;
    }
    used.add(allowance);
    excused.push({ problem, allowance });
  }
  for (const allowance of allowances) {
    if (allowance.reason === "") {
      remaining.push({
        rule: "allowance",
        index: allowance.index,
        detail:
          "this allowance carries no reason. Say why this is prose and not a structure's empty " +
          "state, or take it out and let the finding stand",
      });
    } else if (!used.has(allowance)) {
      remaining.push({
        rule: "allowance",
        index: allowance.index,
        detail:
          "this allowance excuses nothing: no finding starts at the element after it. Take it out — " +
          "an entry that has outlived its violation is how a list stops being read",
      });
    }
  }
  return { problems: remaining, excused };
}

// --- one file --------------------------------------------------------------------------------

/** Audit one Svelte file. Every problem carries the file, a line and the rule. */
export function auditFile(path, source) {
  const markup = markupOf(source);
  const tree = parseMarkup(markup);
  const found = [...findLooseEmptyBranches(tree), ...findProseAfterStructures(tree)];
  const { problems, excused } = applyAllowances(found, allowancesIn(source));
  const place = (problem) => ({ ...problem, file: path, line: lineOf(markup, problem.index) });
  return {
    problems: problems.map(place).sort((a, b) => a.line - b.line),
    excused: excused.map(({ problem, allowance }) => ({ problem: place(problem), allowance })),
  };
}
