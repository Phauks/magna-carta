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
 * THREE RULES, all answered from the sidebar registry and the route tree rather than a list kept
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
 */

/** The one control. Anything else claiming to be a screen's search is the defect. */
export const SCREEN_SEARCH = "ScreenSearch";

/** The one header. Its `actions` snippet is the top right of every screen. */
export const SCREEN_HEADER = "ScreenHeader";

/** The sidebar registry: where a destination's group, its path and whether it shipped all live. */
export const DESTINATIONS_SOURCE = "apps/web/src/lib/navigation/destinations.ts";

/** The group heading this gate binds. The Money and Firm groups are not in its scope. */
export const WORKSPACE_GROUP = "top";

/*
 * RECORDED DECLINES. A Workspace screen with no search, with the reason, so the exception is
 * visible in the gate rather than absent from it. Every run prints them; a decline recorded for a
 * screen that HAS the control fails, because a stale exemption is an exemption nobody re-reads.
 *
 * Every entry here is the same shape of reason and it is worth naming: the screen's rows are read
 * a page at a time from a server whose read takes no query. Narrowing what happens to be in the
 * browser would answer a different question from the one being asked — "of the forty I have read,
 * which match" rather than "which of yours match" — and would do it silently. The control goes on
 * each of these the day its read takes a query, which is a change to that subsystem's API and not
 * to this screen.
 */
export const DECLINED = new Map([
  [
    "home",
    "Home is a summary of other screens rather than a list of its own — its tiles are each a few " +
      "rows of somebody else's register, and the thing to do with a query here is go to the " +
      "register that holds the answer. That is the command palette's job, which is already on " +
      "this screen in the top bar.",
  ],
  [
    "notifications",
    "The feed is paged off /api/v1/notifications, whose read takes a category and a state and no " +
      "query. Narrowing the pages in hand would report 'nothing matches' to a member whose match " +
      "is two pages further down. Waiting on: the notifications read taking a query.",
  ],
  [
    "conflicts",
    "The log is paged off the conflicts read, which takes no query. Same failure as the feed, and " +
      "worse here: a check somebody cannot find is a professional-responsibility record they have " +
      "to produce. Waiting on: the conflicts log read taking a query.",
  ],
  [
    "magnus",
    "The rail lists conversations, and a search over them is a search over what was SAID in them " +
      "— the transcript, not the title, since nothing generates a title. That is a read across " +
      "message bodies rather than a filter over the rail. Waiting on: the conversation read " +
      "taking a query.",
  ],
  [
    "calendar",
    "A calendar search that reaches only the window on screen answers the wrong question: " +
      "somebody looking for a hearing does not know which month it is in, which is why they are " +
      "searching. Waiting on: the entry read taking a query across a date range rather than one " +
      "window.",
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
    if (seen.has(id) || group !== WORKSPACE_GROUP) continue;
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

/**
 * The bodies of every `{#snippet actions()}…{/snippet}` in a file's markup. Nesting is counted
 * rather than matched lazily, because an actions snippet holding an `{#if}` closes with a `{/if}`
 * of its own and a lazy match would stop at the first one.
 */
export function actionsSnippets(markup) {
  const found = [];
  const opener = /\{#snippet actions\(\)\}/gu;
  const token = /\{#(?:if|each|await|key|snippet)\b|\{\/(?:if|each|await|key|snippet)\}/gu;
  for (const match of markup.matchAll(opener)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let cursor = -1;
    token.lastIndex = start;
    let step;
    while ((step = token.exec(markup)) !== null) {
      if (step[0].startsWith("{#")) {
        depth += 1;
        continue;
      }
      depth -= 1;
      if (depth === 0) {
        cursor = step.index;
        break;
      }
    }
    // An unclosed snippet is a syntax error the compiler reports; here it simply has no body.
    if (cursor === -1) continue;
    found.push({ start, end: cursor });
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
 * `read` answers a path with its source or null; `screenFiles` is every file rule 3 scans, as
 * [{ path, source }].
 */
export function auditWorkspaceSearch({
  destinations,
  pageOf,
  read,
  screenFiles,
  declined = DECLINED,
}) {
  const problems = [];
  const covered = [];
  const declining = [];

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
  }

  return { problems, covered, declining };
}
