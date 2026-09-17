// The decisions behind `lint:test-collection`, as pure functions over already-collected data. The
// spawning half — one list-only run of the test runner — lives in index.mjs.
//
// They are separated because the arithmetic is the part that can be wrong in a way nobody notices.
// This lint exists to PROVE the suite still collects what it should, and a proof whose own reasoning
// is unexercised is worth what the belief it replaced was worth: the workflow comment that claimed a
// mis-scoped path "fails loud" was confidently written, reviewed, and false for months. So the
// assertion below is driven from constructed inputs in collection.test.mjs — shown to bite on the
// failure it names, and to stay quiet on the shape that is legitimately fine.

/**
 * Key a collected entry on the repo-relative path PLUS the project that claimed it, so the same file
 * registered by two projects counts as two entries and every diagnostic names something actionable.
 */
export function specificationKey(entry, normalizedRoot) {
  return `${entry.file.replaceAll("\\", "/").replace(normalizedRoot, "")} [${entry.projectName}]`;
}

/**
 * The one property the whole-suite collection must have: it clears the committed floor. A config
 * change that silently drops whole swathes of the suite — a project that stopped resolving, an include
 * glob that started matching nothing — makes the run faster and greener, and nothing else fails on the
 * absence. Returns a list of human-readable failures; empty means the collection is sound.
 */
export function reconcile({ wholeSuite, floor }) {
  if (wholeSuite.size >= floor) return [];
  return [
    `  the whole-suite invocation collected ${wholeSuite.size} test files, below the committed floor ` +
      `of ${floor}. Either whole suites stopped resolving (find out which — that is the ` +
      `failure this floor exists for), or suites were deliberately removed and the floor in ` +
      `tooling/lint-test-collection/index.mjs needs lowering, with a reason.`,
  ];
}
