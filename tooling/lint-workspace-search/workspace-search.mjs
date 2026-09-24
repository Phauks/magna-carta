/*
 * Every Workspace screen answers the question "how do I search what is on this screen?", and the
 * answer is the same control on every one of them, in the same place.
 *
 * WHY A GATE AND NOT A LEDGER LINE. `ScreenSearch` exists precisely because eleven hand-rolled
 * search boxes improve one at a time and drift in between; its own header comment says so. That
 * argument was written, the component shipped — and the Matters docket and the Directory went on
 * carrying their own `Input type="search"` next to a ghost `Button` with a Lucide search glyph,
 * each with its own 300ms debounce, its own open/close toggle, and its own idea of what pressing
 * the icon on a live query should do. Neither was wrong. They were just a third and a fourth
 * answer to a question the product had already settled, and nothing in the repository said so.
 *
 * The two corrections the owner issued against this control in 2026-09 (an X on a live query;
 * clicking outside an empty field closes it) landed in `ScreenSearch` and reached every screen
 * using it, and reached NEITHER of those two. That is the cost, and it is the ordinary cost of a
 * duplicated surface: the fix is applied where somebody remembered to look.
 *
 * FOUR RULES, all answered from the sidebar registry and the route tree rather than a list kept
 * by hand:
 *
 *   1. COVERAGE. Every shipped destination in the Workspace group renders `ScreenSearch`, or is
 *      recorded below as declining with the reason it declines. Declining is fine and expected —
 *      a screen whose rows are paged off a server that takes no query CANNOT honestly narrow them
 *      in the browser, because it would narrow the pages in hand and silently claim that was the
 *      whole answer. What is refused is not answering.
 *   2. PLACEMENT. Where a file renders both the screen header and the control, the control sits
 *      inside the header's `actions` snippet — the inline end of the title row, which is the one
 *      place a reader looks for it. A search seated in a second row under the title is the shape
 *      the list-screen ruling in docs/conventions/design-corrections.md removed.
 *   3. NO SECOND IMPLEMENTATION. No Workspace screen hand-rolls a search box: no `type="search"`
 *      field, and no Lucide search glyph, outside `ScreenSearch` itself. This is the rule that
 *      would have caught the Matters docket and the Directory on the day they were written.
 *   4. NO SECOND RESULTS SURFACE. A screen searches the list it already shows. Where a query is
 *      live, the SAME table narrows — same columns, same sort, same footer saying how many there
 *      are and whether the answer is capped. A screen that swaps its list out for a second table
 *      while a search runs has answered the question somewhere else, in a surface the reader has
 *      to learn a second time and which drops the columns and the filters they had set up.
 *
 * COVERAGE FOLLOWS THE RENDER, NOT THE FILE. A screen is free to keep its search in the component
 * that owns the list — Tasks hands `TaskList` its header and the list hands the controls back —
 * so the scan walks each page's `$lib` component imports transitively and asks whether the control
 * is anywhere in what the screen actually renders. Reading only the route file would report Tasks
 * as bare when its search works, and a gate that lies about a screen is worse than no gate.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly:
 *
 *   - Whether the search WORKS. A screen can render the control, wire `onsearch` to nothing, and
 *     pass. Only a test against the real screen catches that.
 *   - Whether a declining screen SHOULD still be declining. A decline is a recorded judgement with
 *     a date on it, not a proof; the reasons below are written to be re-read.
 *   - A search box assembled at runtime, or one built from a component named something this scan
 *     does not recognize. Every rule here reads source, not behaviour.
 *   - Placement across the indirection above. Where the control and the header are in DIFFERENT
 *     files the scan cannot see how the two were composed, so rule 2 holds only within one file.
 *     It is the shape that actually drifts.
 *   - A second surface built out of something other than a table — a list of cards, a rail — or one
 *     the screen shows by hiding the list in CSS rather than by branching around it. Rule 4 reads
 *     the shape that shipped: one branch keyed on the query, a table in it and a table in the other
 *     branch. The judgement it encodes is the ruling; the scan is only the part of it a regular
 *     expression can hold.
 *   - A swap written in a file that does not itself hold the search. Rule 4 asks its question of a
 *     file rendering the control, because the query's state and the branch that reads it are
 *     written together; a screen that keeps them apart is not a shape that has shipped here.
 */

/** The one control. Anything else claiming to be a screen's search is the defect. */
export const SCREEN_SEARCH = "ScreenSearch";

/** The one header. Its `actions` snippet is the top right of every screen. */
export const SCREEN_HEADER = "ScreenHeader";

/** The sidebar registry: where a destination's group, its path and whether it shipped all live. */
export const DESTINATIONS_SOURCE = "apps/web/src/lib/navigation/destinations.ts";

/*
 * The group headings this gate binds. The Money, Firm and Tools groups are not in its scope.
 *
 * TWO, not one, and the second is not a widening. The screens this gate has always covered sat in a
 * single `top` group until the rail was regrouped on 2026-09-16; that group split into `desk` (the
 * member's own surfaces — Home, Notifications, Tasks, Calendar, Magnus) and `work` (the firm's
 * work). Binding both keeps the covered set exactly what it was. Binding one would have quietly
 * dropped four screens the owner's correction of 2026-09-14 had just brought INTO scope.
 */
export const WORKSPACE_GROUPS = ["desk", "work"];

/*
 * RECORDED DECLINES. A Workspace screen with no search, with the reason, so the exception is
 * visible in the gate rather than absent from it. Every run prints them; a decline recorded for a
 * screen that HAS the control fails, because a stale exemption is an exemption nobody re-reads.
 *
 * WHAT IS NOT A REASON TO DECLINE, established by the owner's correction of 2026-09-14: that the
 * screen's read takes no search parameter. Four screens were recorded here on exactly that ground
 * — Notifications, Conflicts Check, Magnus, Calendar — and the correction was that a read with no
 * query is a read that should be given one. All four search now, and the work was in the read
 * rather than on the screen. So a decline written here must say why the SCREEN has nothing to
 * search, never why its current API is inconvenient.
 *
 * The true part of that original reasoning survives and still binds, as the thing a screen may not
 * do INSTEAD of declining: narrowing the rows that happen to be in the browser, on a list the
 * server pages, answers "of the forty I have read, which match" while appearing to answer "which
 * of yours match", and answers it silently. Push the query to the server, or say the window is the
 * scope the way the calendar does. Do not quietly search a fraction.
 */
export const DECLINED = new Map([
  [
    "home",
    "Home is a summary of other screens rather than a list of its own — its tiles are each a few " +
      "rows of somebody else's register, and the thing to do with a query here is go to the " +
      "register that holds the answer. That is the command palette's job, which is already on " +
      "this screen in the top bar.",
  ],
]);

/*
 * The shapes a hand-rolled search takes here, both drawn from the two that actually shipped. A
 * `type="search"` field is the field half; a Lucide search glyph is the icon half, and the icon
 * half alone is enough to report because the control it opens is the field.
 */
export const HAND_ROLLED_PATTERNS = [
  {
    rule: "hand-rolled-field",
    pattern: /\btype="search"/u,
    what: 'a `type="search"` field',
  },
  {
    rule: "hand-rolled-glyph",
    pattern: /from "@lucide\/svelte\/icons\/search"/u,
    what: "a Lucide search glyph",
  },
];

/**
 * The roots a screen's list is built on. `DataTable.GridFooter` and `DataTable.Row` are parts of
 * one, not another one, so the trailing character class is load-bearing.
 */
export const LIST_ROOT = /<DataTable\.(?:Root|Grid)[\s/>]/u;

/**
 * Snippet names that draw a PLACEHOLDER of the list rather than a second list: `LoadingRegion`'s
 * `fixture` seam is the same table with sample rows in it, which is why it is written twice. Rule 4
 * blanks these before it counts, or every screen with a loading state would read as having two.
 */
export const PLACEHOLDER_SNIPPETS = new Set(["fixture"]);

/**
 * What a condition has to mention for rule 4 to read it as gating on the query. A screen branching
 * on anything else — a failed read, an empty list, which view is chosen — is branching for a reason
 * that has nothing to do with searching, and rule 4 says nothing about it.
 */
export const SEARCH_STATE = /\b\w*(?:search|query|narrow)\w*\b|\bhits\b/iu;

/*
 * SECOND SURFACES ALLOWED, keyed by the screen file, with the reason. The shape rule 4 reports is
 * nearly always the defect, and the one place it is not is a screen with no single list to narrow:
 * a matter's search reaches its documents, its notes, its time and its people at once, and the
 * owner's ruling of 2026-09-02 gives that answer its own home — the `panel` seam, which opens
 * downward from the control and belongs to it. That is not a swap and never trips this rule,
 * because a panel is not a second table standing where the screen's list was.
 *
 * So an entry here is a screen that genuinely cannot narrow one list, whose answer is nonetheless
 * tabular. Write why the SCREEN has no single list, never that the swap was quicker. An allowance
 * over a screen that no longer swaps fails, the way a stale decline does.
 */
export const SECOND_SURFACE_ALLOWED = new Map([]);

/*
 * Replaces a matched region with spaces, newlines kept, so it occupies the same offsets it did.
 * Every rule here reports a line number against the ORIGINAL source, so a region that is deleted
 * rather than blanked slides every later match earlier and quietly misreports the line — which is
 * worse than not reporting one.
 */
const blank = (text) => text.replace(/[^\n]/gu, " ");

/**
 * Blanks every comment, in the script block and the markup alike, so a scan never matches a
 * mention inside prose.
 */
export function withoutComments(source) {
  return source.replace(/<!--[\s\S]*?-->/gu, blank).replace(/\/\*[\s\S]*?\*\//gu, blank);
}

/** Just the markup: the script block blanked as well, for the rules that read what is rendered. */
export function markupOf(source) {
  return withoutComments(source).replace(/<script[\s\S]*?<\/script>/gu, blank);
}

/** The line a character offset falls on, 1-indexed, for a message somebody can click. */
export function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * The Workspace destinations, as [{ id, label, href, shipped }]. Read out of the registry source
 * rather than imported, so this gate stays a plain script with no build step behind it.
 */
export function workspaceDestinations(source) {
  const found = [];
  const entry =
    /\bid:\s*"([^"]+)",\s*\n\s*label:\s*"([^"]+)",\s*\n\s*href:\s*"([^"]+)",[\s\S]{0,600}?\bgroup:\s*"([a-z]+)",\s*\n\s*shipped:\s*(true|false)/gu;
  const seen = new Set();
  for (const match of source.matchAll(entry)) {
    const [, id, label, href, group, shipped] = match;
    if (seen.has(id) || !WORKSPACE_GROUPS.includes(group)) continue;
    seen.add(id);
    found.push({ id, label, href, shipped: shipped === "true" });
  }
  return found;
}

/** Whether a file renders the one control. */
export function rendersScreenSearch(source) {
  return new RegExp(`<${SCREEN_SEARCH}[\\s/>]`, "u").test(markupOf(source));
}

/** Whether a file renders the one header. */
export function rendersScreenHeader(source) {
  return new RegExp(`<${SCREEN_HEADER}[\\s/>]`, "u").test(markupOf(source));
}

/**
 * Every `$lib/…` Svelte component a file imports, as repository-relative paths. Only `.svelte`
 * imports: a `.ts` module renders nothing, so it cannot hold a screen's search.
 */
export function libComponentImports(source, { webSource = "apps/web/src" } = {}) {
  const imports = [];
  for (const match of withoutComments(source).matchAll(/from\s+"\$lib\/([^"]+\.svelte)"/gu)) {
    imports.push(`${webSource}/lib/${match[1]}`);
  }
  return imports;
}

/**
 * Whether the control is anywhere in what a page renders, following `$lib` component imports.
 * `read` answers a repository-relative path with its source, or null when there is no such file.
 */
export function searchReachableFrom(entry, read) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (source === null) continue;
    if (rendersScreenSearch(source)) return true;
    queue.push(...libComponentImports(source));
  }
  return false;
}

/** The index just past the `}` that closes the block tag starting at `at`. */
function endOfTag(markup, at) {
  const close = markup.indexOf("}", at);
  return close === -1 ? markup.length : close + 1;
}

/**
 * A block tag's text, keyword and all: `{#if searching`, `{:else if hits === null`. A `}` inside
 * the expression — an object literal, an arrow with a body — ends it early; markup conditions are
 * one comparison in practice, and reading to the first brace costs less than parsing Svelte.
 */
function tagText(markup, at) {
  const close = markup.indexOf("}", at);
  return markup.slice(at, close === -1 ? markup.length : close);
}

/**
 * Every Svelte block in a file's markup, as [{ kind, name, tagStart, bodyStart, end, branches }].
 * An `{#if}` carries its branches — the `{#if}` itself, each `{:else if}` and the `{:else}` — each
 * with the text of its own condition, or null for the `{:else}`.
 *
 * Nesting is counted rather than matched lazily, because a block holding an `{#if}` closes with a
 * `{/if}` of its own and a lazy match would stop at the first one. Everything rule 2 and rule 4 ask
 * is a question about which block a thing sits in, so the two share this one walk.
 */
export function svelteBlocks(markup) {
  const found = [];
  const open = [];
  const token =
    /\{#(if|each|await|key|snippet)\b|\{\/(if|each|await|key|snippet)\}|\{:else(\s+if\b)?/gu;
  let step;
  while ((step = token.exec(markup)) !== null) {
    const [, opener, closer, elseIf] = step;
    const at = step.index;

    if (opener !== undefined) {
      const bodyStart = endOfTag(markup, at);
      const block = { kind: opener, name: "", tagStart: at, bodyStart, end: markup.length };
      if (opener === "snippet") {
        block.name = (/\{#snippet\s+([A-Za-z_$][\w$]*)/u.exec(tagText(markup, at)) ?? ["", ""])[1];
      }
      if (opener === "if") {
        block.branches = [{ condition: tagText(markup, at), start: bodyStart, end: markup.length }];
      }
      open.push(block);
      found.push(block);
      continue;
    }

    if (closer !== undefined) {
      // An unbalanced closer is a syntax error the compiler reports; here it closes nothing, and
      // whatever it skipped past is dropped rather than left open to swallow the rest of the file.
      const index = open.findLastIndex((block) => block.kind === closer);
      if (index === -1) continue;
      const block = open[index];
      block.end = at;
      if (block.branches !== undefined) block.branches.at(-1).end = at;
      open.length = index;
      continue;
    }

    // `{:then}` and `{:catch}` reach here too; only an `{#if}` directly above takes a branch.
    const block = open.at(-1);
    if (block === undefined || block.branches === undefined) continue;
    block.branches.at(-1).end = at;
    block.branches.push({
      condition: elseIf === undefined ? null : tagText(markup, at),
      start: endOfTag(markup, at),
      end: markup.length,
    });
  }
  return found;
}

/** The bodies of every `{#snippet actions()}…{/snippet}` in a file's markup. */
export function actionsSnippets(markup) {
  return svelteBlocks(markup)
    .filter((block) => block.kind === "snippet" && block.name === "actions")
    .map((block) => ({ start: block.bodyStart, end: block.end }));
}

/** Every named snippet's body text, by name. A re-declared name keeps the last, as Svelte does. */
export function snippetBodies(markup) {
  const bodies = new Map();
  for (const block of svelteBlocks(markup)) {
    if (block.kind !== "snippet" || block.name === "") continue;
    bodies.set(block.name, markup.slice(block.bodyStart, block.end));
  }
  return bodies;
}

/** Markup with the placeholder snippets' bodies blanked, offsets and lines kept. */
export function withoutPlaceholderSnippets(markup) {
  let out = markup;
  for (const block of svelteBlocks(markup)) {
    if (block.kind !== "snippet" || !PLACEHOLDER_SNIPPETS.has(block.name)) continue;
    const body = out.slice(block.bodyStart, block.end);
    out = out.slice(0, block.bodyStart) + blank(body) + out.slice(block.end);
  }
  return out;
}

/** Markup with every snippet's body blanked: what the file actually RENDERS, not what it defines. */
export function withoutSnippetBodies(markup) {
  let out = markup;
  for (const block of svelteBlocks(markup)) {
    if (block.kind !== "snippet") continue;
    const body = out.slice(block.bodyStart, block.end);
    out = out.slice(0, block.bodyStart) + blank(body) + out.slice(block.end);
  }
  return out;
}

/**
 * The names of the snippets that draw a list, directly or through another snippet. The Directory's
 * search table was reached through exactly this indirection — one snippet, rendered twice — so a
 * scan that read only literal tags would have found the swap it was written for invisible.
 */
export function listRootSnippets(markup) {
  const bodies = snippetBodies(markup);
  const holding = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of bodies) {
      if (holding.has(name) || !drawsList(body, holding)) continue;
      holding.add(name);
      grew = true;
    }
  }
  return holding;
}

/** Whether a region draws a list: a table of its own, or a render of a snippet that holds one. */
export function drawsList(region, snippets) {
  if (LIST_ROOT.test(region)) return true;
  for (const name of snippets) {
    if (new RegExp(`\\{@render\\s+${name}\\s*\\(`, "u").test(region)) return true;
  }
  return false;
}

/** Whether a branch's condition is about the query rather than about anything else. */
export function namesSearchState(condition) {
  return condition !== null && SEARCH_STATE.test(condition);
}

/**
 * Rule 4, over one file: where a screen swaps its list for a second one while a query is live, by
 * offset. Two shapes, both drawn from the Directory as it stood before the correction:
 *
 *   - A list in TWO branches of one `{#if}` chain that asks about the query. That is the swap
 *     written out: the hits in one branch, the screen's own grid in the other.
 *   - A list inside a branch gated ON the query, while the file renders another list outside that
 *     chain. The same swap assembled from two conditionals instead of one.
 *
 * A single list under a query-shaped condition is not reported: narrowing between "nothing matches
 * that" and the table is the in-place shape, and it is how most of these screens are written.
 */
export function secondResultsSurfaces(source) {
  const markup = withoutPlaceholderSnippets(markupOf(source));
  const snippets = listRootSnippets(markup);
  const found = [];

  for (const chain of svelteBlocks(markup)) {
    if (chain.branches === undefined) continue;
    if (!chain.branches.some((branch) => namesSearchState(branch.condition))) continue;

    const drawing = chain.branches.filter((branch) =>
      drawsList(markup.slice(branch.start, branch.end), snippets),
    );
    if (drawing.length === 0) continue;
    if (drawing.length > 1) {
      found.push({ index: chain.tagStart });
      continue;
    }

    // One list in the chain. It is a swap only when the query is what put it there AND the screen
    // draws another list somewhere else — otherwise this is a screen narrowing its own table.
    if (!namesSearchState(drawing[0].condition)) continue;
    const rendered = withoutSnippetBodies(markup);
    const elsewhere =
      rendered.slice(0, chain.tagStart) +
      blank(rendered.slice(chain.tagStart, chain.end)) +
      rendered.slice(chain.end);
    if (drawsList(elsewhere, snippets)) found.push({ index: chain.tagStart });
  }

  return found;
}

/** Every `<ScreenSearch` in a file's markup, by offset. */
export function screenSearchTags(markup) {
  const tags = [];
  for (const match of markup.matchAll(new RegExp(`<${SCREEN_SEARCH}[\\s/>]`, "gu"))) {
    tags.push(match.index ?? 0);
  }
  return tags;
}

/**
 * The Workspace screens, audited.
 *
 * `destinations` is the Workspace group as `workspaceDestinations` reads it; `pageOf` answers a
 * destination's href with the repository-relative path of the route page that serves it, or null;
 * `read` answers a path with its source or null; `screenFiles` is every file rules 3 and 4 scan, as
 * [{ path, source }].
 */
export function auditWorkspaceSearch({
  destinations,
  pageOf,
  read,
  screenFiles,
  declined = DECLINED,
  allowedSecondSurface = SECOND_SURFACE_ALLOWED,
}) {
  const problems = [];
  const covered = [];
  const declining = [];
  const allowing = [];

  for (const destination of destinations) {
    if (!destination.shipped) continue;
    const page = pageOf(destination.href);
    if (page === null) {
      // A shipped destination with no page of its own is a registry/route disagreement, which is
      // a different gate's business. Nothing here can be said about a screen that is not there.
      continue;
    }

    const hasSearch = searchReachableFrom(page, read);
    const reason = declined.get(destination.id) ?? null;

    if (hasSearch && reason !== null) {
      problems.push({
        file: page,
        line: 1,
        rule: "stale-decline",
        message:
          `"${destination.label}" renders ${SCREEN_SEARCH} and is ALSO recorded as declining a ` +
          "search. One of the two is out of date, and it is nearly always the record — delete " +
          `the "${destination.id}" entry from DECLINED in ` +
          "tooling/lint-workspace-search/workspace-search.mjs. An exemption that outlives what it " +
          "exempted is an exemption nobody re-reads.",
      });
      covered.push(destination);
      continue;
    }

    if (hasSearch) {
      covered.push(destination);
      continue;
    }

    if (reason !== null) {
      declining.push({ destination, reason });
      continue;
    }

    problems.push({
      file: page,
      line: 1,
      rule: "no-search",
      message:
        `"${destination.label}" is a Workspace screen and neither renders ${SCREEN_SEARCH} nor ` +
        "says why it does not. Put the control in the screen header's `actions` snippet — it " +
        "rests as an icon and costs the screen no vertical space — or, if the screen's rows are " +
        "paged off a read that takes no query, record the decline with its reason in DECLINED in " +
        "tooling/lint-workspace-search/workspace-search.mjs. Both are fine answers; silence is " +
        "not.",
    });
  }

  for (const { path: file, source } of screenFiles) {
    const markup = markupOf(source);

    // Rule 2 — placement, within one file.
    if (rendersScreenHeader(source)) {
      const ranges = actionsSnippets(markup);
      for (const at of screenSearchTags(markup)) {
        if (ranges.some((range) => at >= range.start && at < range.end)) continue;
        problems.push({
          file,
          line: lineOf(source, at),
          rule: "placement",
          message:
            `renders ${SCREEN_SEARCH} outside the ${SCREEN_HEADER}'s \`actions\` snippet. A ` +
            "screen's search sits at the inline end of the title row, which is the one place a " +
            "reader looks for it; a search in a second row under the title is the shape the " +
            "list-screen ruling removed. Move it into `{#snippet actions()}`.",
        });
      }
    }

    // Rule 3 — no second implementation.
    const body = withoutComments(source);
    for (const { rule, pattern, what } of HAND_ROLLED_PATTERNS) {
      const match = pattern.exec(body);
      if (match === null) continue;
      problems.push({
        file,
        line: lineOf(source, match.index ?? 0),
        rule,
        message:
          `builds its own search out of ${what}. ${SCREEN_SEARCH} is the product's one control ` +
          "for searching within a screen, and it already carries the debounce, the clear glyph, " +
          "Escape, the collapse-on-click-away and the two corrections the owner issued against " +
          "it in 2026-09 — none of which a second copy gets. Use " +
          "`@magna-carta/design-system/screen-search`.",
      });
    }

    // Rule 4 — no second results surface. Asked only of a file that holds the search itself: the
    // query's state and the swap are written together, and a file with neither says nothing here.
    if (!rendersScreenSearch(source)) continue;
    const swaps = secondResultsSurfaces(source);
    const allowance = allowedSecondSurface.get(file) ?? null;

    if (swaps.length > 0 && allowance !== null) {
      allowing.push({ file, reason: allowance });
      continue;
    }

    if (swaps.length === 0 && allowance !== null) {
      problems.push({
        file,
        line: 1,
        rule: "stale-second-surface",
        message:
          "searches its list in place and is ALSO recorded as allowed a second results surface. " +
          `Delete the "${file}" entry from SECOND_SURFACE_ALLOWED in ` +
          "tooling/lint-workspace-search/workspace-search.mjs — an exemption that outlives what " +
          "it exempted is an exemption nobody re-reads.",
      });
      continue;
    }

    for (const swap of swaps) {
      problems.push({
        file,
        line: lineOf(source, swap.index),
        rule: "second-results-surface",
        message:
          "swaps its list out for a second results surface while a query is live. A screen " +
          "searches the list it already shows: the query goes to the read — or narrows the rows " +
          "in the browser where every row is already there — and the SAME table, with the same " +
          "columns and the same sort, shows what matched, while the footer states how many there " +
          "are and says so when the answer is capped. A second table is a second surface to " +
          "learn, and it throws away the columns, the sort and the filters the reader set up. " +
          "Where a screen has no single list to narrow, the answer is ScreenSearch's `panel` " +
          "seam, which opens downward from the control and belongs to it, not a table standing " +
          "where the list was. A screen that must keep one is recorded, with its reason, in " +
          "SECOND_SURFACE_ALLOWED in tooling/lint-workspace-search/workspace-search.mjs.",
      });
    }
  }

  return { problems, covered, declining, allowing };
}
