import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectFragments, ensureDatedSection, foldFragments } from "./changelog.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FRAGMENT_DIR = join(ROOT, "changelog.d");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const PUBLIC_CHANGELOG = join(ROOT, "docs/public-changelog.md");

// Fold one set of fragments into both assembled documents at once. Both, in one pass, because the
// customer-facing prose lives ONLY in the fragment and the fragment is deleted when it is consumed:
// a publish step deferred to later would have nothing left to publish. Pure, so the property that
// matters — a public fragment reaches the public document — is testable without a repository.
export function assembleChangelogs({ changelog, publicChangelog, fragments, date }) {
  const folded = foldFragments(changelog, fragments);

  const published = fragments
    .filter((fragment) => fragment.audience === "public")
    .map((fragment) => ({ category: fragment.category, text: fragment.publicText }));
  if (published.length === 0) {
    return { changelog: folded, publicChangelog, publishedCount: 0 };
  }
  const dated = ensureDatedSection(publicChangelog, date);
  return {
    changelog: folded,
    publicChangelog: foldFragments(dated, published, `## ${date}`),
    publishedCount: published.length,
  };
}

function build() {
  if (!existsSync(FRAGMENT_DIR)) return;
  const names = readdirSync(FRAGMENT_DIR).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  );
  if (names.length === 0) return;

  // Validate the WHOLE set before consuming any of it. Folding deletes the fragment, so a
  // half-consumed assembly loses the entries it already ate and cannot be re-run; a bad fragment has
  // to be a clean no-op instead. The same validation runs as `pnpm run lint:changelog-fragments` on
  // the author's own branch, where the fix is one line.
  const { records, problems } = collectFragments(
    names.map((name) => ({
      key: name,
      context: `changelog.d/${name}`,
      markdown: readFileSync(join(FRAGMENT_DIR, name), "utf8"),
    })),
  );
  if (problems.length > 0) {
    console.error(
      `\nchangelog: ${problems.length} problem(s) across ${names.length} fragment(s) — nothing was folded and nothing was deleted.\n`,
    );
    console.error(problems.map((problem) => `  ${problem}`).join("\n"));
    console.error(
      "\nFormat: changelog.d/README.md. Check them any time with `pnpm run lint:changelog-fragments`.",
    );
    process.exit(1);
  }

  const assembled = assembleChangelogs({
    changelog: readFileSync(CHANGELOG, "utf8"),
    publicChangelog: readFileSync(PUBLIC_CHANGELOG, "utf8"),
    fragments: [...records.values()],
    date: new Date().toISOString().slice(0, 10),
  });

  writeFileSync(CHANGELOG, assembled.changelog);
  if (assembled.publishedCount > 0) writeFileSync(PUBLIC_CHANGELOG, assembled.publicChangelog);
  for (const name of names) rmSync(join(FRAGMENT_DIR, name));
  console.log(
    `changelog: folded ${names.length} fragment(s), ${assembled.publishedCount} of them published.`,
  );
}

// Run the side effects only when invoked as a script — importing this module (for a test of
// assembleChangelogs) must not rewrite the real changelogs or delete the real fragments.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build();
