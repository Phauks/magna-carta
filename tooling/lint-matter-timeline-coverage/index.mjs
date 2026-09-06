/*
 * Every federated timeline source is owned by exactly one matter section, or declared ownerless.
 *
 * The matter's Activity section opens a row into the section that owns it, and it asks the section
 * registry which one that is — `timelineSources` on each section in sections.ts — rather than
 * keeping a second list of its own that would be free to fall behind. What that lookup cannot do on
 * its own is make anybody REMEMBER to answer it: a source declared in packages/calendar with no
 * owner is not a visible defect, the row simply opens nowhere and nothing says why. That is the
 * failure this gate makes impossible rather than merely unlikely.
 *
 * Three directions of drift, all refused:
 *
 *   - a registered source that no section owns and `UNSECTIONED_TIMELINE_SOURCES` does not name;
 *   - a source owned by two sections, which is two answers to "where does this open";
 *   - a section or the ownerless map naming a key no registered source answers to.
 *
 * Usage: node tooling/lint-matter-timeline-coverage/index.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SECTIONS = "apps/web/src/lib/matters/sections.ts";
const SOURCES = "packages/calendar/src/sources/all.ts";

// The registered source keys, read from the registry module's own `key:` declarations. Reading the
// source rather than importing it keeps this gate dependency-free and runnable before a build.
function registeredSourceKeys(text) {
  return new Set([...text.matchAll(/^\s*key:\s*"([^"]+)",/gmu)].map((match) => match[1]));
}

// One entry per section: its slug and the sources it owns. Parsed from the object literals rather
// than imported, for the same reason.
function sectionOwnership(text) {
  const declarations = [];
  for (const block of text.split(/^\s*\{$/mu).slice(1)) {
    const slug = /slug:\s*"([^"]+)"/u.exec(block);
    if (slug === null) continue;
    const owned = /timelineSources:\s*\[([^\]]*)\]/u.exec(block);
    declarations.push({
      slug: slug[1],
      declared: owned !== null,
      sources: owned === null ? [] : [...owned[1].matchAll(/"([^"]+)"/gu)].map((m) => m[1]),
    });
  }
  return declarations;
}

// The ownerless declarations: `key: "reason"` pairs inside UNSECTIONED_TIMELINE_SOURCES.
function unsectionedSources(text) {
  const block = /UNSECTIONED_TIMELINE_SOURCES[^{]*\{([\s\S]*?)\n\};/u.exec(text);
  if (block === null) return new Map();
  return new Map(
    [...block[1].matchAll(/^\s*([A-Za-z]+):\s*"([^"]+)"/gmu)].map((match) => [match[1], match[2]]),
  );
}

const sectionsText = readFileSync(new URL(SECTIONS, `file://${ROOT}`), "utf8");
const sourcesText = readFileSync(new URL(SOURCES, `file://${ROOT}`), "utf8");

const keys = registeredSourceKeys(sourcesText);
const sections = sectionOwnership(sectionsText);
const unsectioned = unsectionedSources(sectionsText);
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

const owners = new Map();
for (const section of sections) {
  if (!section.declared) {
    failures.push(
      `${SECTIONS}: section "${section.slug}" declares no \`timelineSources\`. Name the timeline ` +
        `sources whose rows it owns, or declare \`timelineSources: []\`.`,
    );
    continue;
  }
  for (const key of section.sources) {
    if (!keys.has(key)) {
      failures.push(
        `${SECTIONS}: section "${section.slug}" owns timeline source "${key}", which no source in ` +
          `${SOURCES} answers to.`,
      );
    }
    const already = owners.get(key);
    if (already !== undefined) {
      failures.push(
        `${SECTIONS}: timeline source "${key}" is owned by both "${already}" and "${section.slug}". ` +
          `A row opens into one section; pick it.`,
      );
    }
    owners.set(key, section.slug);
  }
}

for (const [key] of unsectioned) {
  if (!keys.has(key)) {
    failures.push(
      `${SECTIONS}: UNSECTIONED_TIMELINE_SOURCES names "${key}", which no source in ${SOURCES} ` +
        `answers to.`,
    );
  }
  if (owners.has(key)) {
    failures.push(
      `${SECTIONS}: timeline source "${key}" is both owned by "${owners.get(key)}" and declared ` +
        `ownerless. It is one or the other.`,
    );
  }
}

for (const key of keys) {
  if (!owners.has(key) && !unsectioned.has(key)) {
    failures.push(
      `${SOURCES}: timeline source "${key}" is owned by no section's \`timelineSources\` and is ` +
        `not in UNSECTIONED_TIMELINE_SOURCES. Say which section its rows open into, or say why none ` +
        `does — an Activity row that opens nowhere with no reason reads as a broken product.`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(
  `Matter timeline coverage: every one of ${keys.size} registered source(s) is placed — ` +
    `${owners.size} owned by a section, ${unsectioned.size} declared ownerless with a reason.`,
);
