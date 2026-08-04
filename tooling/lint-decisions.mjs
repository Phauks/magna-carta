import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectAdrRecords } from "./doc-fragments/adr-file.mjs";

// Fitness function for decision files (mirrors lint-status.mjs). Fails CI when a pending fragment
// or an already-numbered decision file is malformed — missing its frontmatter fence, carrying an
// unknown frontmatter key, missing status/area, or opening its body with a Markdown title.
//
// It exists because the register in docs/Decision-Log.md is generated from these files and used to
// degrade silently: a fragment that opened with a title parsed into an all-empty record, and the
// assembler happily rendered a bullet with two blank fields and the title where the decision text
// belongs. The assembler now refuses such a file outright; this gate moves that refusal forward to
// the author's own pull request, where the fix is one edit rather than a repair of merged output.
// Run: `pnpm run lint:decisions`.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DECISIONS_DIR = join(ROOT, "docs/decisions");
const PENDING_DIR = join(DECISIONS_DIR, "pending");

function checkDirectory(directory, relativePath, matches) {
  // The pending directory is empty between merges, and an empty directory is not tracked, so a
  // fresh clone may not have it at all.
  if (!existsSync(directory)) return { problems: [], checked: 0 };
  const names = readdirSync(directory).filter(matches);
  const { problems } = collectAdrRecords(
    names.map((name) => ({
      context: `${relativePath}/${name}`,
      markdown: readFileSync(join(directory, name), "utf8"),
    })),
  );
  return { problems, checked: names.length };
}

const numbered = checkDirectory(DECISIONS_DIR, "docs/decisions", (name) =>
  /^\d{4}-.+\.md$/.test(name),
);
const pending = checkDirectory(
  PENDING_DIR,
  "docs/decisions/pending",
  (name) => name.endsWith(".md") && name !== "README.md",
);

const problems = [...pending.problems, ...numbered.problems];
if (problems.length > 0) {
  console.error("\nDecision files failed validation:\n");
  console.error(problems.map((problem) => `  ${problem}`).join("\n"));
  console.error(
    `\n${problems.length} problem(s). Format: docs/decisions/README.md. The register is generated from these files, so \`vp run decisions-build\` refuses to run until they are fixed.`,
  );
  process.exit(1);
}
console.log(
  `Decision files valid (${pending.checked} pending fragment(s), ${numbered.checked} numbered).`,
);
