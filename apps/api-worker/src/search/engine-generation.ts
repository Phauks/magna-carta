import type { Bindings } from "../bindings.ts";

// WHICH ENGINES THIS DEPLOYMENT CAN ACTUALLY REACH, as one short token.
//
// The index pipeline bounds how many times it re-attempts a document, so a document nothing can read
// stops costing the repair sweep anything after a few passes. That bound has to be relative to
// SOMETHING, or a deploy that finally binds the recognition engine would find the whole backlog
// permanently written off — every one of those documents having been "tried" against a pipeline that
// could not have read them.
//
// The generation is that something. It changes exactly when the set of reachable engines changes, which
// is precisely when a previous refusal stops being informative, and it is derived from the bindings
// rather than from a version number a person has to remember to bump.
export function searchEngineGeneration(env: Bindings): string {
  const extraction = env.OCR_SERVICE === undefined ? "none" : "recognition";
  const index = env.SEARCH_SERVICE === undefined ? "none" : "search";
  return `extract:${extraction}|index:${index}`;
}
