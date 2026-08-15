import { EDGE_TYPES } from "@magna-carta/directory/types";

// WHY A CLASS AND NOT A NUMBER. One integer cannot express "follow a corporate rename chain forever
// but do not walk from a spouse to her employer's other directors". The two are different questions
// about what a relationship MEANS, and a single hop budget answers them with the same number because
// it cannot tell them apart. So traversal is budgeted per edge class, and the classes are named here
// once so the expansion, the settings, and the recorded scope can never disagree about which class an
// edge type belongs to.

// Corporate family is deliberately absent from the budgeted classes: it is traversed transitively at
// zero cost and bounded only by the per-run closure cap. A rename, merger, or successor chain of any
// length is the same legal person continuing, so bounding it by hops would miss exactly what the
// search exists to find.
export const BUDGETED_EDGE_CLASSES = ["control", "family", "representation"] as const;
export type BudgetedEdgeClass = (typeof BUDGETED_EDGE_CLASSES)[number];

export const EDGE_CLASSES = ["corporate", ...BUDGETED_EDGE_CLASSES] as const;
export type EdgeClass = (typeof EDGE_CLASSES)[number];

// The Directory's edge-type catalogue, partitioned. Every well-known type appears exactly once, and
// the fitness test below the map proves it stays that way as the catalogue grows.
//
//   corporate      — the same legal person continuing under another name or another shell.
//   control        — who directs whom. An adverse organization and its principals are the case the
//                    Rule 1.7 comments describe; the principals' OTHER directorships are a further
//                    hop and unbounded in practice, which is what the budget is for.
//   family         — the opposing party's spouse the firm represented elsewhere.
//   representation — a role-link recorded as an edge rather than as a matter_party row.
export const EDGE_TYPES_BY_CLASS: Readonly<Record<EdgeClass, readonly string[]>> = Object.freeze({
  corporate: ["corporate_parent", "corporate_subsidiary", "corporate_successor"],
  control: ["affiliation"],
  family: ["relationship"],
  representation: ["representation", "role_assignment"],
});

const CLASS_BY_EDGE_TYPE = new Map<string, EdgeClass>(
  Object.entries(EDGE_TYPES_BY_CLASS).flatMap(([edgeClass, edgeTypes]) =>
    edgeTypes.map((edgeType) => [edgeType, edgeClass as EdgeClass] as const),
  ),
);

// Corporate-family edge types, kept as a named export because the traversal reads them as "the
// zero-cost class" rather than as three strings.
export const CORPORATE_EDGE_TYPES: readonly string[] = EDGE_TYPES_BY_CLASS.corporate;

// The class an edge type falls in, or null when this build has never heard of it.
//
// `directory_edge.edge_type` carries only a `length > 0` CHECK, so a value outside the catalogue is
// storable and a future catalogue entry will reach this function before anyone updates the map above.
// Returning null rather than guessing is deliberate: the caller decides what an unclassified type
// costs, and `budgetForEdgeType` gives it the WIDEST budgeted allowance rather than the narrowest,
// because a new relationship type that silently became unwalkable is a conflict the engine stopped
// looking for without anybody choosing that.
export function edgeClassOf(edgeType: string): EdgeClass | null {
  return CLASS_BY_EDGE_TYPE.get(edgeType) ?? null;
}

// Every well-known edge type this build knows, in catalogue order — the input to the coverage test
// that fails when a new Directory edge type lands with no class beside it.
export const CLASSIFIED_EDGE_TYPES: readonly string[] = EDGE_TYPES;
