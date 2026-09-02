/*
 * What a person has typed into the register's three entry forms, and whether it can be recorded yet.
 *
 * PURE, AND SEPARATE FROM THE DIALOGS ON PURPOSE. Every one of these forms has a control that must
 * be disabled with a reason rather than pressed into a server refusal the client could see coming,
 * and "what is still missing" is the only interesting logic any of them has. Held in the component
 * it would be three copies of the same reasoning, each testable only by driving a modal.
 *
 * A SHORTFALL IS A SENTENCE, NOT A FLAG. The forms disable their submit and print what is missing,
 * so the reader is told which field is holding them up instead of hunting a greyed-out button. The
 * order the sentences come back in is the order the fields are read in, so the first one named is
 * the first one to fix.
 *
 * THE LIMITS ARE THE CONTRACT'S, RESTATED. Every length below is the bound the same field carries
 * in apps/api-worker/openapi/openapi.json. Restating them is duplication with a purpose: the server
 * is still the authority and still refuses, and this only stops a person losing a long note to a
 * 422 they could have been warned about while typing. A bound that moves there and not here costs a
 * warning that fires early, never a write that should have been refused and was not.
 */
import type {
  AddCustodyItemRequest,
  CreateCustodyPacketRequest,
  LinkCustodyScanRequest,
} from "./custody-api.ts";
import type { CustodyScanKind } from "./custody-vocabulary.ts";

/** The contract's own bounds on what these three forms send. */
const PACKET_NAME_LIMIT = 300;
const PACKET_NOTES_LIMIT = 4000;
const CUSTODY_NUMBER_LIMIT = 64;
const OWNERSHIP_ROLE_LIMIT = 100;
const OWNER_LIMIT = 20;
const ITEM_DESCRIPTION_LIMIT = 2000;
const INSTRUMENT_DATE_LIMIT = 40;

/** One owner as the form holds it: the handle it will send, and the name it shows meanwhile. */
export interface PacketOwnerDraft {
  entityId: string;
  /** What the directory calls them. Never sent; the register stores handles and resolves nothing. */
  displayName: string;
  /** What this owner is to the property. Empty means the form names nothing, and sends nothing. */
  ownershipRole: string;
}

/**
 * Everything the packet form holds. Dates are plain ISO days, never instants.
 *
 * TWO FIELDS ARE NAMED IN THE FIRM'S WORDS RATHER THAN THE CONTRACT'S, and the mapping is done once
 * in `packetDraftRequest` below. The register's row calls them `depositor_entity_id` and
 * `deposited_at`; the firm calls them the TRUSTOR and the ACQUISITION DATE, which is what the form
 * says. Naming the draft after the screen keeps the translation in one function instead of leaving
 * every reader of this form to hold both vocabularies at once.
 */
export interface PacketDraft {
  name: string;
  owners: readonly PacketOwnerDraft[];
  locationId: string | null;
  /**
   * The matter this property is held under. REQUIRED, in the firm's rule and in the contract alike:
   * property is held for a client, a client is somebody with a matter, and the firm does not hold
   * originals for people it has no matter with. Nullable HERE only because the form starts before
   * the question is answered; `packetDraftRequest` cannot produce a request without it.
   */
  matterId: string | null;
  /** Who handed the property over. The contract's `depositorEntityId`. */
  trustorEntityId: string | null;
  /** When the firm actually took it, which is rarely the day the row is typed. `depositedAt`. */
  acquiredOn: string | null;
  notes: string;
  /**
   * A number the property already carries on its physical label, from a paper deeds register or a
   * system the firm is migrating off. Set it and the register keeps that number and draws none, so
   * nobody has to re-label objects sitting in a safe. Empty means the register draws the next one.
   */
  existingNumber: string;
  /** What is inside, described before the packet is saved. Each becomes one item after it exists. */
  items: readonly ItemDraft[];
}

/** A form nobody has typed into yet. */
export const EMPTY_PACKET_DRAFT: PacketDraft = {
  name: "",
  owners: [],
  locationId: null,
  matterId: null,
  trustorEntityId: null,
  acquiredOn: null,
  notes: "",
  existingNumber: "",
  items: [],
};

/**
 * What still stops this packet being logged.
 *
 * THE MATTER IS NAMED FIRST because everything else on the form depends on it: the owners a packet
 * can be held for are that matter's parties, so a form with no matter cannot offer an owner at all.
 * The other three are the register's own: property with no name cannot be asked for, property held
 * for nobody can never be given back, and property at no location is property the firm has lost.
 * Everything else on the form is genuinely optional and is not named here.
 */
export function packetDraftShortfalls(draft: PacketDraft): readonly string[] {
  const shortfalls: string[] = [];
  if (draft.matterId === null) shortfalls.push("Choose the matter this is held under.");

  const name = draft.name.trim();
  if (name === "") shortfalls.push("Name what the firm is holding.");
  else if (name.length > PACKET_NAME_LIMIT) {
    shortfalls.push(`The name is longer than ${PACKET_NAME_LIMIT} characters.`);
  }

  if (draft.owners.length === 0) {
    shortfalls.push("Name at least one person or organization this is held for.");
  } else if (draft.owners.length > OWNER_LIMIT) {
    shortfalls.push(`A packet records at most ${OWNER_LIMIT} owners.`);
  } else if (
    draft.owners.some((owner) => owner.ownershipRole.trim().length > OWNERSHIP_ROLE_LIMIT)
  ) {
    shortfalls.push(`An ownership role is longer than ${OWNERSHIP_ROLE_LIMIT} characters.`);
  }

  if (draft.locationId === null) shortfalls.push("Say where it is being kept.");

  if (draft.notes.trim().length > PACKET_NOTES_LIMIT) {
    shortfalls.push(`The notes are longer than ${PACKET_NOTES_LIMIT} characters.`);
  }
  if (draft.existingNumber.trim().length > CUSTODY_NUMBER_LIMIT) {
    shortfalls.push(`An existing number is longer than ${CUSTODY_NUMBER_LIMIT} characters.`);
  }
  // An item nobody finished describing would be posted as a blank line inside the packet, so the
  // form refuses the whole submit rather than silently dropping it.
  if (draft.items.some((item) => !itemDraftReady(item))) {
    shortfalls.push("Finish or remove the item being described.");
  }
  return shortfalls;
}

/** Whether the packet form can be sent. */
export function packetDraftReady(draft: PacketDraft): boolean {
  return packetDraftShortfalls(draft).length === 0;
}

/**
 * The packet form as the contract takes it.
 *
 * An untouched optional field is ABSENT rather than sent empty. The difference is not cosmetic: a
 * blank string reaches the server as an answer somebody gave, and the register would record that
 * the firm was told the depositor is nobody rather than that nobody was asked.
 */
export function packetDraftRequest(draft: PacketDraft): CreateCustodyPacketRequest {
  const locationId = draft.locationId;
  const matterId = draft.matterId;
  if (locationId === null || matterId === null) {
    throw new Error(
      "A packet cannot be logged without a matter and a location. Ask packetDraftReady first.",
    );
  }
  const notes = draft.notes.trim();
  const existingNumber = draft.existingNumber.trim();
  return {
    name: draft.name.trim(),
    owners: draft.owners.map((owner) => {
      const role = owner.ownershipRole.trim();
      return { entityId: owner.entityId, ...(role === "" ? {} : { ownershipRole: role }) };
    }),
    currentLocationId: locationId,
    matterId,
    // The one place the form's words become the contract's: the Trustor is the row's depositor and
    // the Acquisition Date is the row's deposited-at. Stated here so neither vocabulary has to be
    // carried anywhere else.
    ...(draft.trustorEntityId === null ? {} : { depositorEntityId: draft.trustorEntityId }),
    ...(draft.acquiredOn === null ? {} : { depositedAt: draft.acquiredOn }),
    ...(notes === "" ? {} : { notes }),
    ...(existingNumber === "" ? {} : { manualCustodyNumber: existingNumber }),
  };
}

/** Everything the item form holds. */
export interface ItemDraft {
  description: string;
  itemTypeId: string | null;
  instrumentDate: string | null;
  /** The assertion that this original is irreplaceable. It can never be walked back. */
  intrinsicValue: boolean;
}

/** A form nobody has typed into yet. */
export const EMPTY_ITEM_DRAFT: ItemDraft = {
  description: "",
  itemTypeId: null,
  instrumentDate: null,
  intrinsicValue: false,
};

/**
 * What still stops this item being described.
 *
 * Only the description is required, and that is the domain's answer rather than a light touch: an
 * item is the unit of DESCRIPTION, so an item nobody has described is not an item.
 */
export function itemDraftShortfalls(draft: ItemDraft): readonly string[] {
  const shortfalls: string[] = [];
  const description = draft.description.trim();
  if (description === "") shortfalls.push("Describe what is inside.");
  else if (description.length > ITEM_DESCRIPTION_LIMIT) {
    shortfalls.push(`The description is longer than ${ITEM_DESCRIPTION_LIMIT} characters.`);
  }
  if ((draft.instrumentDate ?? "").length > INSTRUMENT_DATE_LIMIT) {
    shortfalls.push("The instrument date is not a date the register can hold.");
  }
  return shortfalls;
}

/** Whether the item form can be sent. */
export function itemDraftReady(draft: ItemDraft): boolean {
  return itemDraftShortfalls(draft).length === 0;
}

/**
 * The item form as the contract takes it.
 *
 * `intrinsicValue` is sent whichever way it is set, unlike every other optional field here. The
 * firm's item-type catalog carries a default for it, and sending nothing would let that default
 * overrule a person who deliberately unticked the box in front of the object.
 */
export function itemDraftRequest(draft: ItemDraft): AddCustodyItemRequest {
  return {
    description: draft.description.trim(),
    ...(draft.itemTypeId === null ? {} : { itemTypeId: draft.itemTypeId }),
    ...(draft.instrumentDate === null ? {} : { instrumentDate: draft.instrumentDate }),
    intrinsicValue: draft.intrinsicValue,
  };
}

/** Everything the filed-copy form holds. */
export interface ScanDraft {
  fileId: string | null;
  kind: CustodyScanKind;
  /** The one item this copy is of, where it is of one rather than of the whole packet. */
  itemId: string | null;
  capturedAt: string | null;
}

/** A form nobody has touched. A plain scan is what a firm files most of the time. */
export const EMPTY_SCAN_DRAFT: ScanDraft = {
  fileId: null,
  kind: "scan",
  itemId: null,
  capturedAt: null,
};

/** What still stops this copy being linked. */
export function scanDraftShortfalls(draft: ScanDraft): readonly string[] {
  return draft.fileId === null ? ["Choose the filed document this copy is."] : [];
}

/** Whether the filed-copy form can be sent. */
export function scanDraftReady(draft: ScanDraft): boolean {
  return scanDraftShortfalls(draft).length === 0;
}

/** The filed-copy form as the contract takes it. */
export function scanDraftRequest(draft: ScanDraft): LinkCustodyScanRequest {
  const fileId = draft.fileId;
  if (fileId === null) {
    throw new Error("A copy cannot be linked without a file. Ask scanDraftReady first.");
  }
  return {
    fileId,
    kind: draft.kind,
    ...(draft.itemId === null ? {} : { itemId: draft.itemId }),
    ...(draft.capturedAt === null ? {} : { capturedAt: draft.capturedAt }),
  };
}
