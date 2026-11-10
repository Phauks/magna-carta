import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The board is the one surface where people at many firms read and write the same rows. What keeps
// it from ever showing a firm's own data is that this package cannot reach a firm's database at all:
// it may not depend on the firm-scoped data-access layer, may not import the per-firm schema, and may
// not name a per-firm binding. Held here as a test so the boundary is a property of the build, not of
// a reviewer remembering it.

const packageRoot = join(import.meta.dirname, "..");
const sourceFiles = readdirSync(join(packageRoot, "src"), { recursive: true })
  .map(String)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => join(packageRoot, "src", file));

describe("community package isolation", () => {
  it("declares no dependency on the firm-scoped data-access layer", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(names).not.toContain("@magna-carta/data-access");
  });

  it.each(sourceFiles)("%s reaches no firm's own database", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/@magna-carta\/data-access/);
    expect(source).not.toMatch(/per-firm-schema/);
    expect(source).not.toMatch(/firmDatabaseFor|FirmDatabase|DB_FIRM/);
  });

  it("never selects who voted", () => {
    const statements = readFileSync(join(packageRoot, "src", "board-statements.ts"), "utf8");
    // The only per-person vote read is "has THIS viewer voted", keyed by the viewer's own user id.
    const voteReads = [...statements.matchAll(/SELECT[^`]*FROM community_vote[^`]*/g)].map(
      (match) => match[0],
    );
    for (const read of voteReads) {
      expect(read.includes("user_id = ?1") || read.includes("COUNT(")).toBe(true);
    }
  });
});
