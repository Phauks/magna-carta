/*
 * A screen carries ONE create control — the design system's CreateControl — and nothing on the
 * screen competes with it.
 *
 * On a matter, the control sits in the header beside the search and reads its label from the
 * section registry and its behaviour from the section's page, so it serves every section from one
 * place in the band. On the docket, the directory and the custody register it sits in the
 * masthead's action row. What that arrangement cannot do on its own is stop the next screen from
 * growing a create button of its own — the very thing the control replaced, which sat a different
 * distance down the screen on every tab. A second button is not a visible defect on the day it
 * ships: it renders, it works, and review does not scale to noticing that one of fourteen
 * sections has quietly taken the control's job back. This gate makes that impossible rather than
 * merely unlikely.
 *
 * Three questions, each refused when unanswered:
 *
 *   1. THE MATTER REGISTRY ANSWERS FOR EVERY SECTION. Each entry in sections.ts declares
 *      `createNoun`: the noun the control offers ("Fee" reads as New Fee), or `CREATE_SEVERAL_KINDS`
 *      where the control opens a menu and reads the bare "New", or `null` with a `createWaitingOn`
 *      line the disabled control carries. A noun is one capitalised word within the budget the
 *      control's fixed width holds — CREATE_NOUN_MAX_LENGTH, read from the design system's
 *      create-label.ts so the two cannot drift. The registry checks the same rules when it loads;
 *      this runs them over the source before anything is built.
 *
 *   2. EVERY NOUN WRITTEN IN MARKUP ANSWERS THE SAME GRAMMAR. The registry above covers the matter
 *      sections, which declare their nouns as data; a top-level screen writes `noun="…"` on the
 *      component itself, and until 2026-09-18 nothing read those at all. `assertCreateNoun` throws
 *      on a bad one, and it throws WHILE THE SCREEN RENDERS — so the whole page becomes the crash
 *      screen, for everyone, on every visit. That is what happened to the template library: it
 *      shipped `noun="Template"` against a budget of seven, and /documents was a crash from the
 *      moment it deployed. The refusal was always loud; nothing was listening early enough.
 *
 *   3. NO RIVAL CREATE BUTTON ON A SCREEN THAT CARRIES THE CONTROL. Starting from every route under
 *      matters/[id] and from the docket, the directory and the custody register, and following each
 *      `.svelte` import a screen renders, a `<Button>` or `<DropdownMenu.Trigger>` that wears the
 *      plus glyph (`<Plus`), or whose label reads as a create verb ("New …", "Record a …", "Log
 *      Time", "Write Note", "Draft Bill"), is a rival. Record windows, dialogs and menus
 *      (`*-window.svelte`, `*-dialog.svelte`, `*-menu.svelte`) are their own surfaces and are not
 *      walked: a plus inside a record window adds a line to a record, it does not create the
 *      screen's record. The design system's own component is the one holder of the glyph, and it is
 *      not under the walked roots.
 *
 * What this does not catch, said plainly: a noun computed at runtime rather than written as a
 * literal (`noun={something}` is counted and skipped, and the component still refuses it on
 * render), a button assembled at runtime, a glyph other than Plus used to mean "create", a create
 * verb the list above does not name, or a screen not named as a root. The design-corrections
 * ledger and review answer those; this answers what can be read from source.
 *
 * Usage: node tooling/lint-matter-create-control/index.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_SOURCE = join(ROOT, "apps/web/src");
const SECTIONS = "apps/web/src/lib/matters/sections.ts";
const LABEL_GRAMMAR = "packages/design-system/src/lib/components/create-control/create-label.ts";
const ROUTES = "apps/web/src/routes/(app)/matters/[id]";
/** The screens outside a matter that carry the control in their masthead. */
const FIRM_SCREENS = [
  "apps/web/src/routes/(app)/matters/+page.svelte",
  "apps/web/src/routes/(app)/directory/+page.svelte",
  "apps/web/src/routes/(app)/custodian/+page.svelte",
  // The calendar's two routes render one screen; it carried a hand-built "Record" dropdown with a
  // plus glyph until 2026-09-06, which is exactly the rival this gate exists to refuse and which
  // survived only because the screen was not walked.
  "apps/web/src/routes/(app)/calendar/+page.svelte",
  "apps/web/src/routes/(app)/calendar/firm-events/+page.svelte",
];
/** Surfaces of their own, opened over a section rather than composed into it. */
const OWN_SURFACE = /-(?:window|dialog|menu)\.svelte$/u;

const failures = [];

// --- 1. the registry answers -----------------------------------------------------------------------

const sectionsText = readFileSync(join(ROOT, SECTIONS), "utf8");

const grammarText = readFileSync(join(ROOT, LABEL_GRAMMAR), "utf8");
const budgetMatch = /export const CREATE_NOUN_MAX_LENGTH = (\d+);/u.exec(grammarText);
if (budgetMatch === null) {
  failures.push(
    `${LABEL_GRAMMAR}: CREATE_NOUN_MAX_LENGTH not found. The parse broke; fix this gate.`,
  );
}
const budget = budgetMatch === null ? 0 : Number(budgetMatch[1]);

const sections = [];
for (const block of sectionsText.split(/^\s*\{$/mu).slice(1)) {
  const slug = /slug:\s*"([^"]+)"/u.exec(block);
  if (slug === null) continue;
  const noun = /createNoun:\s*(null|CREATE_SEVERAL_KINDS|"([^"]*)")/u.exec(block);
  sections.push({
    slug: slug[1],
    declared: noun !== null,
    // The bare-"New" encoding is neither a noun to check nor a decline to explain: it says the
    // control opens a menu and the menu items carry the nouns.
    severalKinds: noun?.[1] === "CREATE_SEVERAL_KINDS",
    noun: noun?.[2] ?? null,
    hasReason: /createWaitingOn:\s*$|createWaitingOn:\s*"/mu.test(block),
  });
}
if (sections.length === 0) {
  failures.push(
    `${SECTIONS}: no section declarations found. The parse broke rather than the registry being ` +
      "empty — fix this gate before trusting it.",
  );
}
for (const section of sections) {
  if (!section.declared) {
    failures.push(
      `${SECTIONS}: section "${section.slug}" declares no \`createNoun\`. Name the noun the header's ` +
        "create control offers there, or `CREATE_SEVERAL_KINDS` where it opens a menu and reads " +
        'the bare "New", or `createNoun: null` with a `createWaitingOn` line saying why nothing ' +
        "is created from it — the disabled control carries that line.",
    );
    continue;
  }
  if (section.severalKinds) continue;
  if (section.noun === null) {
    if (!section.hasReason) {
      failures.push(
        `${SECTIONS}: section "${section.slug}" creates nothing and says nothing about why. A ` +
          "disabled control with no line teaches the reader nothing; declare `createWaitingOn`.",
      );
    }
    continue;
  }
  if (!/^[A-Z][a-z]+$/u.test(section.noun)) {
    failures.push(
      `${SECTIONS}: section "${section.slug}" names create noun "${section.noun}", which is not one ` +
        'capitalised word. The control reads "New <Noun>" and nothing else.',
    );
  } else if (section.noun.length > budget) {
    failures.push(
      `${SECTIONS}: section "${section.slug}" names create noun "${section.noun}" ` +
        `(${section.noun.length} characters); the control's fixed width holds ${budget}. Choose a ` +
        "shorter noun: the width is one token shared by every screen, so widening it to fit one " +
        "label widens the control everywhere.",
    );
  }
}

// --- 2. every noun written in markup -----------------------------------------------------------

function svelteFilesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...svelteFilesUnder(path));
    else if (entry.endsWith(".svelte")) found.push(path);
  }
  return found;
}

/**
 * Source with its comments blanked, so prose about a button is never read as one. Blanked rather
 * than removed — every newline is kept — so a line reported below is the line in the file.
 */
function withoutComments(text) {
  const blank = (comment) => comment.replaceAll(/[^\n]/gu, " ");
  return text
    .replaceAll(/<!--[\s\S]*?-->/gu, blank)
    .replaceAll(/\/\*[\s\S]*?\*\//gu, blank)
    .replaceAll(/^\s*\/\/.*$/gmu, blank);
}

/**
 * The open tag that starts at `index`, up to the `>` that ends it.
 *
 * Scanned rather than matched, because the obvious `/<CreateControl[^>]*>/` stops inside
 * `onpress={() => …}` — an arrow is a `>` — and would read half a tag as the whole of it. Quotes
 * and brace depth are tracked so only a `>` at the top level of the tag ends it.
 */
function openTagAt(source, index) {
  let depth = 0;
  let quote = null;
  for (let at = index; at < source.length; at += 1) {
    const character = source[at];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    } else if (character === ">" && depth === 0) {
      return source.slice(index, at + 1);
    }
  }
  return null;
}

const webScreens = existsSync(WEB_SOURCE) ? svelteFilesUnder(WEB_SOURCE) : [];
if (webScreens.length === 0) {
  failures.push(
    `${relative(ROOT, WEB_SOURCE)}: no .svelte files found. The parse broke; fix this gate.`,
  );
}
let literalNouns = 0;
let computedNouns = 0;
for (const path of webScreens) {
  const source = withoutComments(readFileSync(path, "utf8"));
  const relativePath = relative(ROOT, path).replaceAll("\\", "/");
  for (const opening of source.matchAll(/<CreateControl\b/gu)) {
    const tag = openTagAt(source, opening.index);
    if (tag === null) continue;
    const line = source.slice(0, opening.index).split("\n").length;
    const noun = /\bnoun=(?:"([^"]*)"|\{)/u.exec(tag);
    // No `noun` at all, or `noun={null}`, is the bare "New" — a screen whose menu names the kinds.
    if (noun === null) continue;
    if (noun[1] === undefined) {
      computedNouns += 1;
      continue;
    }
    literalNouns += 1;
    const written = noun[1];
    if (!/^[A-Z][a-z]+$/u.test(written)) {
      failures.push(
        `${relativePath}:${line}: the create control names "${written}", which is not one ` +
          'capitalised word. The control reads "New <Noun>" and nothing else; a phrase or a ' +
          "plural does not fit that grammar. CreateControl throws on this while the screen " +
          "renders, which takes the whole page down rather than the button.",
      );
    } else if (written.length > budget) {
      failures.push(
        `${relativePath}:${line}: the create control names "${written}" (${written.length} ` +
          `characters); the control's fixed width holds ${budget}. Choose a shorter noun: the ` +
          "width is one token shared by every screen, so widening it to fit one label widens the " +
          "control everywhere. CreateControl throws on this while the screen renders, which takes " +
          "the whole page down rather than the button.",
      );
    }
  }
}

// --- 3. no rival on a section ------------------------------------------------------------------------

/** Every `.svelte` module a file imports, resolved to a path, or skipped when it is not ours. */
function renderedImports(path, text) {
  const imports = [];
  for (const match of text.matchAll(/from\s+"([^"]+\.svelte)"/gu)) {
    const specifier = match[1];
    let target;
    if (specifier.startsWith("$lib/")) target = join(WEB_SOURCE, "lib", specifier.slice(5));
    else if (specifier.startsWith(".")) target = resolve(dirname(path), specifier);
    else continue;
    if (existsSync(target)) imports.push(target);
  }
  return imports;
}

const CREATE_VERB = /^\s*(?:New\b|Record an?\b|Log Time\b|Write Note\b|Draft Bill\b)/u;

/** The rival buttons in one file: each with the line it starts on and why it counts. */
function rivalsIn(text) {
  const rivals = [];
  const source = withoutComments(text);
  const blocks = source.matchAll(
    /<(Button|DropdownMenu\.Trigger)\b[^>]*?(?<!\/)>([\s\S]*?)<\/\1>/gu,
  );
  for (const block of blocks) {
    const inner = block[2];
    const line = source.slice(0, block.index).split("\n").length;
    if (/<Plus\b/u.test(inner)) {
      rivals.push({ line, reason: "wears the plus glyph" });
      continue;
    }
    const label = inner
      .replaceAll(/<[^>]*>/gu, " ")
      .replaceAll(/\{[^}]*\}/gu, " ")
      .trim();
    if (CREATE_VERB.test(label)) {
      rivals.push({ line, reason: `reads "${label.split(/\s+/u).slice(0, 3).join(" ")}"` });
    }
  }
  return rivals;
}

const routesDirectory = join(ROOT, ROUTES);
if (!existsSync(routesDirectory)) {
  failures.push(`${ROUTES}: not found. The matter routes moved; point this gate at them.`);
}

const seen = new Set();
const queue = existsSync(routesDirectory) ? svelteFilesUnder(routesDirectory) : [];
for (const screen of FIRM_SCREENS) {
  const path = join(ROOT, screen);
  if (existsSync(path)) queue.push(path);
  else failures.push(`${screen}: not found. The screen moved; point this gate at it.`);
}
let walked = 0;
while (queue.length > 0) {
  const path = queue.pop();
  if (seen.has(path)) continue;
  seen.add(path);
  const relativePath = relative(ROOT, path).replaceAll("\\", "/");
  if (OWN_SURFACE.test(relativePath)) continue;
  const text = readFileSync(path, "utf8");
  walked += 1;
  for (const rival of rivalsIn(text)) {
    failures.push(
      `${relativePath}:${rival.line}: a button on a screen that carries the create control ` +
        `${rival.reason}. CreateControl is the one create button on a screen; on a matter section ` +
        "put the action behind it with claimMatterCreate " +
        "(apps/web/src/lib/matters/create-action.svelte.ts), elsewhere render CreateControl itself.",
    );
  }
  queue.push(...renderedImports(path, text));
}
if (walked === 0) {
  failures.push(`${ROUTES}: no section screens walked. The parse broke; fix this gate.`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

// Three answers, counted apart: a section that names one noun, one that makes several kinds and
// reads the bare "New", and one that creates nothing and says why. Folding the middle one into
// either of the others would report a screen that creates plenty as a screen that creates nothing.
const naming = sections.filter((section) => !section.severalKinds && section.noun !== null).length;
const severalKinds = sections.filter((section) => section.severalKinds).length;
const declining = sections.length - naming - severalKinds;
const computedNote = computedNouns === 0 ? "" : ` (${computedNouns} computed, checked on render)`;
console.log(
  `Matter create control: every one of ${sections.length} section(s) answered — ${naming} naming ` +
    `a noun, ${severalKinds} offering several kinds, ${declining} declining with a reason — ` +
    `${literalNouns} noun(s) written in markup fit the ${budget}-character width` +
    `${computedNote}, and no rival create button across ${walked} screen(s) that carry the control.`,
);
