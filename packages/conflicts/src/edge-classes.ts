import { EDGE_TYPES } from "@magna-carta/directory/types";

// WHAT A RELATIONSHIP MEANS, so a path can say it. The classes used to decide how far a walk could
// follow each kind of edge; the owner removed those budgets on 2026-09-11
// (docs/conventions/conflicts-rulings.md, E1) and the walk now follows every class to closure. What survives is the vocabulary: a reviewer reading a path still needs to know that one
// hop was a corporate parent and the next a spouse, and the report groups what it walked by class.
export const EDGE_CLASSES = ["corporate", "control", "family", "representation"] as const;
export type EdgeClass = (typeof EDGE_CLASSES)[number];

// The Directory's edge-type catalogue, partitioned. Every well-known type appears exactly once, and
// the fitness test over the map proves it stays that way as the catalogue grows.
//
//   corporate      — the same legal person continuing under another name or another shell.
//   control        — who directs whom. An adverse organization and its principals are the case the
//                    Rule 1.7 comments describe.
//   family         — the opposing party's spouse the firm represented elsewhere.
//   representation — a role-link recorded as an edge rather than as a matter_party row.
//
// The membership family is classed `control` whole — the officers who can bind the organization AND
// the employees, members and shareholders who cannot. A point of contact is a constituent too, and
// lands in the same class for the same reason.
export const EDGE_TYPES_BY_CLASS: Readonly<Record<EdgeClass, readonly string[]>> = Object.freeze({
  corporate: ["corporate_parent", "corporate_subsidiary", "corporate_successor"],
  control: [
    "affiliation",
    "officer_of",
    "director_of",
    "partner_of",
    "trustee_of",
    "personal_representative_of",
    "agent_of",
    "employment",
    "member_of",
    "shareholder_of",
    "point_of_contact_for",
  ],
  family: [
    "relationship",
    "beneficiary_of",
    "guardian_of",
    "spouse_of",
    "parent_of",
    "child_of",
    "sibling_of",
    "grandparent_of",
    "grandchild_of",
    "family_member_of",
  ],
  representation: ["representation", "role_assignment"],
});

const CLASS_BY_EDGE_TYPE = new Map<string, EdgeClass>(
  Object.entries(EDGE_TYPES_BY_CLASS).flatMap(([edgeClass, edgeTypes]) =>
    edgeTypes.map((edgeType) => [edgeType, edgeClass as EdgeClass] as const),
  ),
);

// Corporate-family edge types, kept as a named export because a reader of a path treats "the same
// legal person continuing" differently from a relationship between two people.
export const CORPORATE_EDGE_TYPES: readonly string[] = EDGE_TYPES_BY_CLASS.corporate;

// The class an edge type falls in, or null when this build has never heard of it.
//
// `directory_edge.edge_type` carries only a `length > 0` CHECK, so a value outside the catalogue is
// storable and a future catalogue entry will reach this function before anyone updates the map above.
// Returning null rather than guessing is deliberate: the walk follows the edge either way, and the
// caller decides what to call it.
export function edgeClassOf(edgeType: string): EdgeClass | null {
  return CLASS_BY_EDGE_TYPE.get(edgeType) ?? null;
}

// Every well-known edge type this build knows, in catalogue order — the input to the coverage test
// that fails when a new Directory edge type lands with no class beside it.
export const CLASSIFIED_EDGE_TYPES: readonly string[] = EDGE_TYPES;
