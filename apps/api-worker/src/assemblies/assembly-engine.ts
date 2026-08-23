// The assembly engine's version, recorded on every provenance row beside the dictionary version.
//
// It is provenance, not configuration: a document assembled today has to stay explicable after the
// substitution engine changes, and "which engine produced these bytes" is the only fact that makes the
// difference between two outputs of the same template version answerable. It moves when the substitution
// or output-emission behaviour changes in a way that could alter produced bytes — not when unrelated
// code in the package changes.
export const ASSEMBLY_ENGINE_VERSION = 1;
