// Renders src/keyword-letter-folds.ts: what the keyword engine does to a letter or digit beyond
// lowercasing it, as the application has to know it.
//
// The engine writes that table out itself, in crates/search-core/tests/fixtures/body-letter-folds.tsv,
// and a test beside its analyzer fails when the file is not what the analyzer does. This turns the
// file into a module, so the application folds an unfinished word exactly as the index folded the
// document's. test/keyword-query.test.ts fails while the two disagree.
//
// usage: node packages/search/scripts/render-keyword-letter-folds.mts

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENGINE_TABLE = new URL(
  "../../../crates/search-core/tests/fixtures/body-letter-folds.tsv",
  import.meta.url,
);
const MODULE = new URL("../src/keyword-letter-folds.ts", import.meta.url);

// The word a letter becomes, then every letter that becomes it, in the engine's own order.
const lettersByWord = new Map<string, string>();
for (const line of readFileSync(ENGINE_TABLE, "utf8").split("\n")) {
  if (line === "" || line.startsWith("#")) continue;
  const [codePoint, word] = line.split("\t");
  if (codePoint === undefined || word === undefined) {
    throw new Error(`not a line of the engine's table: ${line}`);
  }
  const letter = String.fromCodePoint(Number.parseInt(codePoint, 16));
  lettersByWord.set(word, `${lettersByWord.get(word) ?? ""}${letter}`);
}

const entries = [...lettersByWord]
  .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  .map(([word, letters]) => `  [${JSON.stringify(word)}, ${JSON.stringify(letters)}],`);

writeFileSync(
  MODULE,
  `// What the keyword engine does to a letter or digit beyond lowercasing it: the word the index holds,
// then every character it holds that way. A letter or digit that is not here is only lowercased.
//
// RENDERED, never edited: \`node packages/search/scripts/render-keyword-letter-folds.mts\` writes this
// from the table the engine publishes about itself
// (crates/search-core/tests/fixtures/body-letter-folds.tsv), and test/keyword-query.test.ts compares
// the two letter by letter.
export const KEYWORD_LETTER_FOLDS: readonly (readonly [word: string, letters: string])[] = [
${entries.join("\n")}
];
`,
);

// The formatter decides where a long entry breaks, by a width this script would have to imitate.
execFileSync("pnpm", ["exec", "vp", "fmt", fileURLToPath(MODULE)], { stdio: "inherit" });
