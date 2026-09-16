/*
 * The generator's rules, driven against fixtures, plus the one assertion that has to run against the
 * REAL journals: that the committed modules are what a fresh render produces.
 *
 * That last one duplicates `--check` on purpose. The check is a governance lint (it runs on every
 * pull request); this is the same statement inside the test battery, where a reader debugging a
 * migration is already looking, and where the failure names the missing tag rather than the file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundleModuleText, importIdentifierFor, LINEAGES, PRINT_WIDTH } from "./bundle-module.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function journalOf(lineage) {
  const file = path.join(ROOT, "packages/database/drizzle", lineage, "meta/_journal.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

function entry(idx, tag) {
  return { idx, version: "6", when: 0, tag, breakpoints: true };
}

describe("importIdentifierFor", () => {
  it("drops the timestamp and spells the slug out in full", () => {
    expect(importIdentifierFor("20260704T041516_baseline")).toBe("baselineSql");
    expect(importIdentifierFor("20260803T222618_email-capture-route")).toBe("emailCaptureRouteSql");
    expect(importIdentifierFor("20260811T224252_self-serve-registration-and-invitations")).toBe(
      "selfServeRegistrationAndInvitationsSql",
    );
  });
});

describe("bundleModuleText", () => {
  it("emits in TAG order even when the journal's idx order disagrees", () => {
    // The exact shape that put the lineage out of order on main: a branch cut early and merged
    // late keeps its early tag while drizzle renumbers its idx to the end. Apply order is by tag,
    // so the generated module has to read in tag order regardless of where idx put it.
    const text = bundleModuleText("per-firm", [
      entry(0, "20260704T041516_baseline"),
      entry(1, "20260914T120001_event-conference-link"),
      entry(2, "20260911T120001_office-email-address-lines"),
    ]);
    const tags = [...text.matchAll(/drizzle\/per-firm\/(\d{8}T\d{6}_[a-z0-9-]+)\.sql/gu)].map(
      (match) => match[1],
    );
    expect(tags).toEqual([
      "20260704T041516_baseline",
      "20260911T120001_office-email-address-lines",
      "20260914T120001_event-conference-link",
    ]);
  });

  it("bundles every journal entry exactly once, as an import and as a map key", () => {
    const entries = [
      entry(0, "20260704T041516_baseline"),
      entry(1, "20260803T222618_email-capture-route"),
      entry(2, "20260914T120001_event-conference-link"),
    ];
    const text = bundleModuleText("per-firm", entries);
    for (const each of entries) {
      const identifier = importIdentifierFor(each.tag);
      expect(text).toContain(`import ${identifier} from `);
      expect(text).toContain(`"${each.tag}":`);
      // Once as the import, once as the map value — never a third time, which would mean a
      // duplicated entry the runtime would silently take the last of.
      expect(text.split(identifier).length - 1).toBe(2);
    }
  });

  it("refuses two migrations that differ only by their timestamp", () => {
    expect(() =>
      bundleModuleText("per-firm", [
        entry(0, "20260704T041516_matter-notes"),
        entry(1, "20260914T120001_matter-notes"),
      ]),
    ).toThrow(/both import as `matterNotesSql`/u);
  });

  it("refuses a lineage it does not know", () => {
    expect(() => bundleModuleText("third-lineage", [entry(0, "20260704T041516_baseline")])).toThrow(
      /unknown lineage/u,
    );
  });

  it("wraps the tag-to-SQL map where the formatter would wrap it", () => {
    // The emitted module is committed and formatted like any other source, so it has to already be
    // a fixed point of `vp check --fix` — otherwise the generator and the formatter undo each other
    // forever, and `--check` fails on a file nobody edited. The map body is the only construct in
    // the file the formatter can rewrap (an import specifier and a line comment are atomic to it),
    // so it is the only one the generator has to wrap by hand. The longest real tags are the test.
    for (const lineage of Object.keys(LINEAGES)) {
      const text = bundleModuleText(lineage, journalOf(lineage).entries);
      const body = text.split("migrationsFromJournal(")[1]?.split("});")[0] ?? "";
      expect(body, `${lineage}: the map body was not found`).not.toBe("");
      const overlong = body.split("\n").filter((line) => line.length > PRINT_WIDTH);
      expect(overlong, `${lineage}: map lines past ${PRINT_WIDTH} columns`).toEqual([]);
    }
  });

  it("splits an over-width map entry onto two lines, and leaves a fitting one alone", () => {
    const text = bundleModuleText("per-firm", [
      entry(0, "20260704T041516_baseline"),
      entry(1, "20260811T224252_self-serve-registration-and-invitations-and-more-besides"),
    ]);
    expect(text).toContain('    "20260704T041516_baseline": baselineSql,\n');
    expect(text).toContain(
      '    "20260811T224252_self-serve-registration-and-invitations-and-more-besides":\n' +
        "      selfServeRegistrationAndInvitationsAndMoreBesidesSql,\n",
    );
  });
});

describe("the committed modules", () => {
  it.each(Object.keys(LINEAGES))("%s matches a fresh render of its journal", (lineage) => {
    const expected = bundleModuleText(lineage, journalOf(lineage).entries);
    const committed = readFileSync(path.join(ROOT, LINEAGES[lineage].module), "utf8");
    expect(
      committed,
      `${LINEAGES[lineage].module} drifted from the journal — run \`pnpm run migration-bundles\``,
    ).toBe(expected);
  });
});
