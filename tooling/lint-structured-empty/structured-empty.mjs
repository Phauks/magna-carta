/*
 * Fitness function: where data will arrive, the structure that will hold it renders first, empty.
 *
 * THE RULING (2026-09-14). "Places where data will populate and it should be in the table, but it
 * is just loose on the background or the screen. This doesn't prepare the user for incoming
 * information, and makes it more difficult to identify issues." A table renders its header row and
 * its empty body; a definition list renders its terms with empty definitions; a rail renders its
 * frame. The words that explain the emptiness live INSIDE that structure's own empty state — the
 * design system's own words — DataTable.Grid renders "No Results" itself, EventRail takes an
 * `emptyMessage`, the
 * list's own empty row — never as loose prose beside or beneath it on the canvas.
 *
 * THE THREE SHAPES THIS CATCHES are the ones the owner pointed at:
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
 *   3. `table-behind-absence` — a DATA TABLE gated behind the absence of its own rows, with the
 *      product's one `EmptyState` standing in its place: `{#if rows.length === 0}<EmptyState …/>
 *      {:else}<DataTable.Root>…{/if}`, and the same thing one layer in, where a region is handed
 *      an `emptyState` snippet that replaces the table it would otherwise render. THE RULING
 *      (2026-09-18), on downloads and uploads: "downloads and upload pages should show the table
 *      data would populate in, even if there is no data. i want this as a lint and standard rule,
 *      that data tables will still appear before data is in the area. this prepares users for the
 *      proper shape." So where a data table will hold the rows, the table renders first — header
 *      row over an empty body — and the words about the emptiness go in that body:
 *      `DataTable.EmptyRow` for a hand-composed table, and `DataTable.Grid`, which says its own
 *      "No Results" without being asked.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH, stated plainly, because a lint that cries wolf gets deleted:
 *
 *   - A branch that renders a COMPONENT in place of a structure that is NOT a table
 *     (`{:else}<EmptyState …/>` over an `EventRail`, a `Conversation`, a `FolderTree`). The owner
 *     has ruled on the table, where the header row is the shape being promised; for the rest the
 *     words are at least in the product's one empty state and which state is right is review's
 *     call.
 *   - A refusal or a failure standing where a table would. A member who may not see the table, and
 *     a read that broke, are not tables waiting to fill: an empty frame drawn for either promises a
 *     shape the screen has no intention of producing. A failure is not an absence of data, so a
 *     branch whose condition is written in the words of permission or of breakage is read as
 *     neither empty nor this rule's business.
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
      'own, and says "No Results" in it without being asked',
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
        // The body is kept because `{@render …}` carries the only link between a snippet's
        // definition and the place it renders, and a rule that has to follow that link has
        // nothing else to read.
        append({ type: "directive", kind, body, start: index, end: end + 1 });
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

// --- rule 3: a table standing behind an absence ------------------------------------------------

/** The tags that ARE a data table: every part of the one table, and a hand-written `<table>`. */
function isTableTag(name) {
  return name.startsWith("DataTable.") || name === "table";
}

/** The one empty state. A component, which is why the first two rules never looked at it. */
const EMPTY_STATE_TAG = "EmptyState";

/** The snippets a component is handed to render in place of its content when there is none. */
const EMPTY_SNIPPETS = new Set(["emptyState", "empty"]);

/** The snippet a component renders as the shape while its read is in flight. */
const FIXTURE_SNIPPET = "fixture";

/** The name a `{@render name(…)}` calls, or null for any other directive. */
function renderedSnippetName(node) {
  if (node.type !== "directive" || node.kind !== "render") return null;
  return /^@render\s+([A-Za-z_$][\w$]*)/.exec(node.body ?? "")?.[1] ?? null;
}

/** The name a `{#snippet name(…)}` block declares, or null. */
function snippetName(block) {
  if (block.kind !== "snippet") return null;
  return /^([A-Za-z_$][\w$]*)/.exec(block.branches[0]?.condition ?? "")?.[1] ?? null;
}

/**
 * Whether these nodes RENDER something, given the snippet names that are known to render a table.
 * A `{#snippet}` block is a declaration rather than a render, so the walk does not descend into
 * one: what a snippet holds counts where it is rendered, which is what `{@render}` says.
 */
function rendersSomething(nodes, snippets, wanted) {
  for (const node of nodes) {
    if (node.type === "element") {
      if (wanted(node.name)) return true;
      if (rendersSomething(node.children, snippets, wanted)) return true;
    } else if (node.type === "block") {
      if (node.kind === "snippet") continue;
      for (const branch of node.branches) {
        if (rendersSomething(branch.children, snippets, wanted)) return true;
      }
    } else {
      const name = renderedSnippetName(node);
      if (name !== null && snippets.has(name)) return true;
    }
  }
  return false;
}

/** True when these nodes put a data table on the screen, through any depth of snippet. */
export function rendersTable(nodes, snippets = new Set()) {
  return rendersSomething(nodes, snippets, isTableTag);
}

/** True when these nodes put the product's one empty state on the screen. */
export function rendersEmptyState(nodes) {
  return rendersSomething(nodes, new Set(), (name) => name === EMPTY_STATE_TAG);
}

/**
 * The snippets that render a table, directly or through another snippet. The downloads shelf
 * reaches its header row through exactly this indirection — one `shelfHead` snippet, rendered by
 * the fixture and by the real table — so a scan reading only literal tags would miss half of it.
 */
export function tableSnippets(tree) {
  const bodies = new Map();
  for (const block of blocks(tree)) {
    const name = snippetName(block);
    if (name === null) continue;
    bodies.set(
      name,
      block.branches.flatMap((branch) => branch.children),
    );
  }
  const holding = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, children] of bodies) {
      if (holding.has(name) || !rendersTable(children, holding)) continue;
      holding.add(name);
      grew = true;
    }
  }
  return holding;
}

/**
 * The words a branch is written in when what stands there is a REFUSAL or a FAILURE rather than an
 * absence of data: a member who may not see the table, a read that broke. Neither is a table
 * waiting to fill, and drawing an empty frame for either would promise a shape the screen has no
 * intention of producing. A failure is not an absence of data.
 */
const NOT_ABSENCE =
  /\b(?:permission|permitted|denied|forbidden|refused|unauthoris?z?ed|failure|failed|errored?)\w*\b|\b(?:can|may|allow)(?:[A-Z]\w*|ed|s)?\b/i;

/** True when a branch stands in for data that has not arrived — and not for a refusal or a break. */
function standsInForMissingRows(branch) {
  const conditions = [
    branch.condition,
    ...(branch.condition === "" ? branch.block.branches.map((other) => other.condition) : []),
  ];
  if (conditions.some((condition) => NOT_ABSENCE.test(condition))) return false;
  return standsInForAbsence(branch);
}

const BEHIND_ABSENCE_DETAIL =
  "the product's one empty state stands where the table does, so the shape a reader is waiting " +
  "for only appears once the data has. Where a data table will hold the rows, the table renders " +
  "first — its header row over an empty body — and the words about the emptiness go in that empty " +
  'body: DataTable.EmptyRow for a hand-composed table, and DataTable.Grid, which says "No ' +
  'Results" in its own empty body without being asked';

/**
 * Rule 3: a data table gated behind the absence of its own rows.
 *
 * Two arrangements, both of them the downloads and uploads screens as the owner found them: a
 * conditional whose absence branch renders `<EmptyState>` where its other branch renders the
 * table, and a region handed an `emptyState` snippet that does the same thing one layer in.
 */
export function findTablesBehindAbsence(tree) {
  const problems = [];
  const snippets = tableSnippets(tree);
  const report = (nodes) => {
    const [first] = significantChildren(nodes);
    if (first === undefined) return;
    problems.push({
      rule: "table-behind-absence",
      index: first.start,
      detail: BEHIND_ABSENCE_DETAIL,
    });
  };

  for (const block of blocks(tree)) {
    if (!["if", "each", "await"].includes(block.kind)) continue;
    if (block.branches.length < 2) continue;
    if (!block.branches.some((branch) => rendersTable(branch.children, snippets))) continue;
    for (const branch of block.branches) {
      if (rendersTable(branch.children, snippets)) continue;
      if (!rendersEmptyState(branch.children)) continue;
      if (!standsInForMissingRows(branch)) continue;
      report(branch.children);
    }
  }

  for (const container of containers(tree)) {
    if (container.type !== "element") continue;
    const own = container.children.filter(
      (child) => !(child.type === "block" && child.kind === "snippet"),
    );
    const named = new Map();
    for (const child of container.children) {
      const name = child.type === "block" ? snippetName(child) : null;
      if (name !== null)
        named.set(
          name,
          child.branches.flatMap((branch) => branch.children),
        );
    }
    const shape = [...own, ...(named.get(FIXTURE_SNIPPET) ?? [])];
    if (!rendersTable(shape, snippets)) continue;
    for (const [name, children] of named) {
      if (!EMPTY_SNIPPETS.has(name)) continue;
      if (rendersTable(children, snippets)) continue;
      // Prose in an `emptyState` snippet is the same defect one layer in, and the first rule cannot
      // see it: a snippet handed to a component is not a branch of a conditional.
      if (!rendersEmptyState(children) && !isLooseProse(children)) continue;
      report(children);
    }
  }

  return problems.sort((a, b) => a.index - b.index);
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
    found.push({ index: match.index, excuses, reason: match[1].replaceAll(/\s+/g, " ").trim() });
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
  const found = [
    ...findLooseEmptyBranches(tree),
    ...findProseAfterStructures(tree),
    ...findTablesBehindAbsence(tree),
  ];
  const { problems, excused } = applyAllowances(found, allowancesIn(source));
  const place = (problem) => ({ ...problem, file: path, line: lineOf(markup, problem.index) });
  return {
    problems: problems.map(place).sort((a, b) => a.line - b.line),
    excused: excused.map(({ problem, allowance }) => ({ problem: place(problem), allowance })),
  };
}
