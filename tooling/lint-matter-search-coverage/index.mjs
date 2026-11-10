/*
 * Every matter section answers the question "can the matter's search reach this?".
 *
 * The consolidated matter search is built to grow: a fifteenth searchable section costs one source
 * module, one registry line and one presentation entry, and touches neither the route nor the
 * control nor the results page. What that cheapness cannot do on its own is make anybody REMEMBER
 * to pay it. A section added without a source is not a visible defect — the search simply never
 * looks there, the scope dropdown never offers it, and nothing anywhere says so. That is the
 * failure this gate exists to make impossible rather than merely unlikely.
 *
 * So the section registry carries `searchSource` as a REQUIRED answer: a source key, or `null` with
 * `searchWaitingOn` naming what a source there is waiting on. Declining is fine and expected —
 * eight of the fourteen sections decline today, and the scope dropdown renders each one disabled
 * carrying its own line, which is a better answer than silence. What is refused is not answering.
 *
 * Two directions of drift, both refused:
 *
 *   - a section declaring neither a source nor a reason (the forgotten one this exists for);
 *   - a section naming a source key that no registered source answers to, which is a scope option
 *     that would send a query nothing can serve.
 *
 * Usage: node tooling/lint-matter-search-coverage/index.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SECTIONS = "apps/web/src/lib/matters/sections.ts";
const SOURCES = "packages/matter-search/src/sources/all.ts";

// The registered source keys, read from the registry module's own `key:` declarations. Reading the
// source rather than importing it keeps this gate dependency-free and runnable before a build.
function registeredSourceKeys(text) {
  return new Set([...text.matchAll(/^\s*key:\s*"([^"]+)",/gmu)].map((match) => match[1]));
}

// One entry per section: its slug, and what it answered about search. Parsed from the object
// literals rather than imported, for the same reason.
function sectionDeclarations(text) {
  const declarations = [];
  for (const block of text.split(/^\s*\{$/mu).slice(1)) {
    const slug = /slug:\s*"([^"]+)"/u.exec(block);
    if (slug === null) continue;
    const source = /searchSource:\s*(null|"([^"]+)")/u.exec(block);
    const beside = /searchSourcesBeside:\s*\[([^\]]*)\]/u.exec(block);
    const waitingOn = /searchWaitingOn:\s*$|searchWaitingOn:\s*"/mu.test(block);
    declarations.push({
      slug: slug[1],
      declared: source !== null,
      sourceKey: source?.[2] ?? null,
      besideKeys:
        beside === null ? [] : [...beside[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]),
      hasReason: waitingOn,
    });
  }
  return declarations;
}

const sectionsText = readFileSync(new URL(SECTIONS, `file://${ROOT}`), "utf8");
const sourcesText = readFileSync(new URL(SOURCES, `file://${ROOT}`), "utf8");

const keys = registeredSourceKeys(sourcesText);
const sections = sectionDeclarations(sectionsText);
const failures = [];

if (sections.length === 0) {
  failures.push(
    `${SECTIONS}: no section declarations found. The parse broke rather than the registry being ` +
      `empty — fix this gate before trusting it.`,
  );
}
if (keys.size === 0) {
  failures.push(`${SOURCES}: no registered source keys found. The parse broke; fix this gate.`);
}

for (const section of sections) {
  if (!section.declared) {
    failures.push(
      `${SECTIONS}: section "${section.slug}" declares no \`searchSource\`. Name the matter-search ` +
        `source that answers for it, or declare \`searchSource: null\` with a \`searchWaitingOn\` ` +
        `line saying what a source there waits on — the scope dropdown renders that line.`,
    );
    continue;
  }
  if (section.sourceKey === null) {
    if (!section.hasReason) {
      failures.push(
        `${SECTIONS}: section "${section.slug}" declines a search source without a ` +
          `\`searchWaitingOn\` line. A reader who cannot find the section in the scope dropdown ` +
          `learns nothing; one who sees why it is not offered learns exactly where they stand.`,
      );
    }
    continue;
  }
  // The source the section names, and any it names beside it: a section searched in two ways sends
  // both keys, and either one being unknown is the same defect.
  for (const key of [section.sourceKey, ...section.besideKeys]) {
    if (keys.has(key)) continue;
    failures.push(
      `${SECTIONS}: section "${section.slug}" names search source "${key}", which no ` +
        `source in ${SOURCES} answers to. That is a scope option sending a query nothing can serve.`,
    );
  }
}

// The other direction: a registered source no section sends. It would answer under "Everything on
// this matter" and never under the section it belongs to, which reads as the section holding less
// than the matter does.
const sent = new Set(sections.flatMap((section) => [section.sourceKey, ...section.besideKeys]));
for (const key of keys) {
  if (sent.has(key)) continue;
  failures.push(
    `${SOURCES}: source "${key}" is registered and no section in ${SECTIONS} names it, as ` +
      `\`searchSource\` or in \`searchSourcesBeside\`. A search scoped to its section would not ask it.`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

const answering = sections.filter((section) => section.sourceKey !== null).length;
console.log(
  `Matter search coverage: every one of ${sections.length} section(s) answered — ${answering} ` +
    `searchable, ${sections.length - answering} declining with a reason, against ${keys.size} ` +
    `registered source(s).`,
);
