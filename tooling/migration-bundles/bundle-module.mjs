/*
 * The worker's migration bundle, as text — generated from the journal rather than kept by hand.
 *
 * WHY A BUNDLE EXISTS AT ALL. The FirmDatabase Durable Object and the scheduled control-plane
 * applier both run where there is no filesystem, so every migration's SQL has to be inside the
 * worker bundle. That means one `import … from "….sql"` per migration, and a map from tag to the
 * imported text — which was a hand-kept list of forty lines that had to gain an entry every time
 * the journal did.
 *
 * WHY IT IS GENERATED NOW. The hand-kept map failed the same way three times, and the failure is
 * silent at the place it is made: a merge resolves the journal cleanly (the entries are adjacent
 * lines) and drops one branch's import in the same conflict, so the tag is in the journal with
 * nothing bundled behind it. `migrationsFromJournal` throws on that, but only inside a Durable
 * Object on wake — which surfaced as a twenty-second route timeout rather than as a missing import.
 * A test was added to catch it, and then the same class of edit put the entries out of order
 * instead. The journal is the source of truth for which migrations exist; deriving the map from it
 * removes the question.
 *
 * The emitted module is ordinary TypeScript that is committed and linted like any other — not a
 * build artifact — so a reader following `perFirmMigrations` lands on real code. What it must never
 * be is HAND-edited: `--check` in ./index.mjs fails when it drifts from the journal, on the same
 * discipline the OpenAPI snapshot and the drizzle meta/ snapshots are held to.
 */

/** The formatter's column limit (vite.config.ts `printWidth`), which the emitted file must respect. */
export const PRINT_WIDTH = 100;

/** The two lineages, and everything that differs between their generated modules. */
export const LINEAGES = {
  "control-plane": {
    module: "apps/api-worker/src/control-plane-migrations.ts",
    migrationsFunction: "controlPlaneMigrations",
    headFunction: "controlPlaneHeadSchemaVersion",
    journalIdentifier: "controlPlaneJournal",
    /*
     * Who applies this lineage, named so the module says what it is for. Pre-wrapped to the
     * formatter's width: the emitted file is committed and formatted like any other source, so
     * anything this generator writes past 100 columns would be rewrapped on the next `fix` pass and
     * the --check below would then fight the formatter forever.
     */
    applier: [
      "the scheduled handler is the single-flighted sole applier of these against",
      "DB_CONTROL",
    ],
  },
  "per-firm": {
    module: "apps/api-worker/src/per-firm-migrations.ts",
    migrationsFunction: "perFirmMigrations",
    headFunction: "perFirmHeadSchemaVersion",
    journalIdentifier: "perFirmJournal",
    applier: ["each FirmDatabase Durable Object applies these against its own storage on", "wake"],
  },
};

/**
 * The identifier a migration's SQL text is imported under: the slug in camelCase, spelled out in
 * full, with a `Sql` suffix. `20260908T000000_baseline` becomes `baselineSql`.
 *
 * Names are never shortened — a reader scanning the import list should see the same words the
 * migration's filename uses, because that list is how a missing or duplicated entry is spotted.
 */
export function importIdentifierFor(tag) {
  const slug = tag.replace(/^\d{8}T\d{6}_/u, "");
  const camel = slug
    .split(/[-_]/u)
    .filter((word) => word.length > 0)
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join("");
  return `${camel}Sql`;
}

/**
 * The module text for one lineage, given its journal entries.
 *
 * Entries are emitted in TAG order, which is the order every database applies them in
 * (packages/database/src/migration.ts). Reading the import list top to bottom is therefore reading
 * the lineage, and a migration sitting in the wrong place is visible rather than merely present.
 */
export function bundleModuleText(lineage, entries) {
  const shape = LINEAGES[lineage];
  if (shape === undefined) throw new Error(`unknown lineage: ${lineage}`);

  const ordered = [...entries].sort((left, right) =>
    left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0,
  );

  const identifiers = new Map();
  for (const entry of ordered) {
    const identifier = importIdentifierFor(entry.tag);
    const taken = identifiers.get(identifier);
    if (taken !== undefined) {
      // Two migrations whose slugs differ only by their timestamp would import under one name and
      // the second would silently win. Refusing is the only safe answer: the repair is to rename
      // one migration's slug, which costs nothing before it deploys.
      throw new Error(
        `${lineage}: ${entry.tag} and ${taken} both import as \`${identifier}\` — give one a ` +
          "distinct slug (two migrations may not differ only by their timestamp)",
      );
    }
    identifiers.set(identifier, entry.tag);
  }

  const imports = ordered
    .map(
      (entry) =>
        `import ${importIdentifierFor(entry.tag)} from "@magna-carta/database/drizzle/${lineage}/${entry.tag}.sql";`,
    )
    .join("\n");

  /*
   * One entry per migration, wrapped exactly where the formatter would wrap it. A key and value that
   * do not fit on one line go onto two, which is what prettier does with an over-width object
   * property — matching it here is what makes the emitted file a fixed point of `vp check --fix`.
   */
  const mapEntries = ordered
    .map((entry) => {
      const oneLine = `    "${entry.tag}": ${importIdentifierFor(entry.tag)},`;
      return oneLine.length <= PRINT_WIDTH
        ? oneLine
        : `    "${entry.tag}":\n      ${importIdentifierFor(entry.tag)},`;
    })
    .join("\n");

  return `// @generated by tooling/migration-bundles from packages/database/drizzle/${lineage}/meta/_journal.json.
// Run \`pnpm run migration-bundles\` after adding, renaming or removing a migration;
// \`pnpm run lint:migration-bundles\` fails when this file and the journal disagree.
//
// The ${lineage} migration lineage bundled INTO the worker, because the runtime that applies it has
// no filesystem — ${shape.applier[0]}
// ${shape.applier[1]}. The plain .sql text-import contract is src/sql-modules.d.ts.
//
// Imports are in TAG order, which is the order every database applies them in
// (packages/database/src/migration.ts). Do not hand-edit: the journal decides what is here.
import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import ${shape.journalIdentifier} from "@magna-carta/database/drizzle/${lineage}/meta/_journal.json";
${imports}

export function ${shape.migrationsFunction}(): Migration[] {
  return migrationsFromJournal(${shape.journalIdentifier}, {
${mapEntries}
  });
}

/**
 * The lineage head: the greatest TAG, which is the last migration applied — apply order is by tag.
 *
 * A single pass for the maximum rather than a sort: the journal is small, only the greatest is
 * wanted, and neither \`sort\` (which mutates, so it needs a defensive copy) nor \`toSorted\` (absent
 * from this worker's TypeScript lib target) survives a formatter pass intact.
 */
export function ${shape.headFunction}(): string {
  let headTag: string | undefined;
  for (const entry of ${shape.journalIdentifier}.entries) {
    if (headTag === undefined || entry.tag > headTag) headTag = entry.tag;
  }
  if (headTag === undefined) throw new Error("${lineage} migration journal is empty");
  return headTag;
}
`;
}
