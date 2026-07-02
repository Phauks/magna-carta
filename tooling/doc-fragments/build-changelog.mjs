import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldFragments, parseFragment } from "./changelog.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FRAGMENT_DIR = join(ROOT, "changelog.d");
const CHANGELOG = join(ROOT, "CHANGELOG.md");

if (existsSync(FRAGMENT_DIR)) {
  const names = readdirSync(FRAGMENT_DIR).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  );
  if (names.length > 0) {
    const fragments = names.map((name) =>
      parseFragment(readFileSync(join(FRAGMENT_DIR, name), "utf8")),
    );
    writeFileSync(CHANGELOG, foldFragments(readFileSync(CHANGELOG, "utf8"), fragments));
    for (const name of names) rmSync(join(FRAGMENT_DIR, name));
    console.log(`changelog: folded ${names.length} fragment(s)`);
  }
}
