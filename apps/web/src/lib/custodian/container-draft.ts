/*
 * Adding a container from inside the form that needed one.
 *
 * WHY THE PACKET FORM CAN MAKE A CONTAINER. Container is one of the three answers a packet cannot
 * be saved without, and until this existed nothing in the app could create one: the server had the
 * write, the screen had no door to it, so a firm's first packet met an empty list and a save that
 * could never turn on. The place a person discovers they need a shelf is the form asking them for
 * one, so that is where the shelf is made.
 *
 * WHERE A NEW CONTAINER CAN GO. Inside one of the firm's open containers, inside one of the firm's
 * offices, or on its own (a bank vault, an offsite store). An office the tree has never mentioned
 * has no node yet, so choosing it means the office's own root is created first and the new
 * container hangs from it. The server lets only a root name an office, which is why the office has
 * to be its own node rather than a label on the container.
 *
 * Pure, so the choice of parent and the shape of what is sent are pinned by tests without a
 * browser.
 */
import type { CustodyLocationNode, CreateCustodyLocationRequest } from "./custody-api.ts";
import { custodyLocationOptions } from "./location-options.ts";
import {
  LOCATION_KINDS,
  locationKindLabel,
  type CustodyLocationKind,
} from "./custody-vocabulary.ts";

/** The contract's bound on a container's name. */
const CONTAINER_NAME_LIMIT = 200;

/** An office as this form needs it: only what places a container. */
export interface ContainerOffice {
  id: string;
  name: string;
  firmDefault: boolean;
}

/** One place a new container can be put, as the Inside field offers it. */
export interface ContainerParentOption {
  /** `container:<id>`, `office:<id>`, or the empty string for "on its own". */
  value: string;
  label: string;
}

/** The value of the Inside choice that puts a container at the top of the tree. */
export const STANDS_ALONE = "standalone";
const CONTAINER_PREFIX = "container:";
const OFFICE_PREFIX = "office:";

/** Everything the add-a-container panel holds. */
export interface ContainerDraft {
  name: string;
  kind: CustodyLocationKind | "";
  /** One of the Inside choices' values. */
  parent: string;
}

/**
 * The places a new container can go: every open container by its path, then every office that is
 * not already a container in the tree, then "on its own".
 */
export function containerParentOptions(
  nodes: readonly CustodyLocationNode[],
  offices: readonly ContainerOffice[],
): readonly ContainerParentOption[] {
  const containers = custodyLocationOptions(nodes).map((option) => ({
    value: `${CONTAINER_PREFIX}${option.id}`,
    label: option.path,
  }));
  const rooted = new Set(
    nodes.filter((node) => node.firmLocationId !== null).map((node) => node.firmLocationId),
  );
  const unrootedOffices = offices
    .filter((office) => !rooted.has(office.id))
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((office) => ({ value: `${OFFICE_PREFIX}${office.id}`, label: office.name }));
  return [
    ...containers,
    ...unrootedOffices,
    { value: STANDS_ALONE, label: "Standalone (such as a bank or offsite storage)" },
  ];
}

/**
 * Where a new container goes when nobody has said: the firm's default office, as a container if
 * the tree already has it and as an office otherwise, or on its own for a firm with no office.
 */
export function defaultContainerParent(
  nodes: readonly CustodyLocationNode[],
  offices: readonly ContainerOffice[],
): string {
  const office = offices.find((candidate) => candidate.firmDefault) ?? offices[0];
  if (office === undefined) return STANDS_ALONE;
  const root = nodes.find((node) => node.firmLocationId === office.id && node.status === "active");
  return root === undefined ? `${OFFICE_PREFIX}${office.id}` : `${CONTAINER_PREFIX}${root.id}`;
}

/**
 * The kind a typed name already says, so "Box 4" or "Deeds Safe" does not have to be told twice.
 * A name that names no kind leaves the choice to the person.
 */
export function kindFromName(name: string): CustodyLocationKind | "" {
  const words = name.toLowerCase().split(/[^a-z]+/u);
  for (const kind of LOCATION_KINDS) {
    if (words.includes(kind) || words.includes(locationKindLabel(kind).toLowerCase())) return kind;
  }
  if (words.includes("vault")) return "bank";
  return "";
}

/** Why the panel's Add Container cannot be pressed yet, or null when it can. */
export function containerDraftShortfall(draft: ContainerDraft): string | null {
  const name = draft.name.trim();
  if (name === "") return "Name the container.";
  if (name.length > CONTAINER_NAME_LIMIT) {
    return `The name is longer than ${CONTAINER_NAME_LIMIT} characters.`;
  }
  if (draft.kind === "") return "Say what kind of container it is.";
  return null;
}

/**
 * What the save sends, in order: the office's own root first where the container goes into an
 * office the tree has not met yet, then the container itself. `parentLocationId` on the second
 * request is filled in from the first one's answer, which is why the office is returned apart.
 */
export function containerDraftRequests(
  draft: ContainerDraft,
  offices: readonly ContainerOffice[],
): {
  officeRoot: CreateCustodyLocationRequest | null;
  container: CreateCustodyLocationRequest;
} {
  const kind = draft.kind;
  if (kind === "" || containerDraftShortfall(draft) !== null) {
    throw new Error(
      "A container cannot be added before it is named. Ask containerDraftShortfall first.",
    );
  }
  const container: CreateCustodyLocationRequest = { name: draft.name.trim(), kind };
  if (draft.parent.startsWith(CONTAINER_PREFIX)) {
    return {
      officeRoot: null,
      container: { ...container, parentLocationId: draft.parent.slice(CONTAINER_PREFIX.length) },
    };
  }
  if (draft.parent.startsWith(OFFICE_PREFIX)) {
    const officeId = draft.parent.slice(OFFICE_PREFIX.length);
    const office = offices.find((candidate) => candidate.id === officeId);
    if (office === undefined) throw new Error(`No office ${officeId} is on offer.`);
    // A container that IS the office (kind office) is the office's root itself, not a child of it.
    if (kind === "office") {
      return { officeRoot: null, container: { ...container, firmLocationId: office.id } };
    }
    return {
      officeRoot: { name: office.name, kind: "office", firmLocationId: office.id },
      container,
    };
  }
  return { officeRoot: null, container };
}
