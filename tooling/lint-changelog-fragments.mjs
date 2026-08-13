import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFragments } from "./doc-fragments/changelog.mjs";

// Fitness function for changelog fragments (mirrors lint-decisions.mjs). Fails CI when a fragment is
// malformed — missing its frontmatter fence, carrying an unknown key, missing `category:` or
// `audience:`, marked public with no `## Public` block (or internal with one), or carrying an emoji.
//
// `audience:` is the reason this gate exists. Two documents are assembled from one fragment
// directory: CHANGELOG.md for the people building this, and docs/public-changelog.md for the people
// using it. Which of the two a fragment feeds is a judgement the author has to make, and neither
// default is safe to fall back on — assuming public publishes an internal research note the first
// time somebody forgets, and assuming internal means the public changelog quietly stops being
// written, which is worse because nothing announces it. So the key is required and an undecided
// fragment fails here, on the author's own branch, where the fix is one line rather than a repair of
// assembled output on main.
//
// Run: `pnpm run lint:changelog-fragments`.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FRAGMENT_DIR = join(ROOT, "changelog.d");
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;

// The fragment directory is empty between assemblies, and an empty directory is not tracked, so a
// fresh clone may not have it at all.
const names = existsSync(FRAGMENT_DIR)
  ? readdirSync(FRAGMENT_DIR).filter((name) => name.endsWith(".md") && name !== "README.md")
  : [];

const { problems } = collectFragments(
  names.map((name) => ({
    key: name,
    context: `changelog.d/${name}`,
    markdown: readFileSync(join(FRAGMENT_DIR, name), "utf8"),
  })),
);

// The filename is the slug other documents and the assembler's own output refer to, so it is held to
// the same shape as every other fragment directory in the tree.
for (const name of names) {
  if (!KEBAB_CASE.test(name)) {
    problems.push(`changelog.d/${name}: the filename is not a kebab-case slug ending in .md`);
  }
}

if (problems.length > 0) {
  console.error("\nChangelog fragments failed validation:\n");
  console.error(problems.map((problem) => `  ${problem}`).join("\n"));
  console.error(
    `\n${problems.length} problem(s). Format: changelog.d/README.md. Both changelogs are generated from these files, so \`vp run changelog-build\` refuses to run until they are fixed.`,
  );
  process.exit(1);
}
console.log(`Changelog fragments valid (${names.length} fragment(s)).`);
