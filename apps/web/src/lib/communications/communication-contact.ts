/*
 * Who is at the other end of a call or text being recorded — chosen, cleared, and shown at rest.
 *
 * Shared by the form's own contact field (where a record already on the log is corrected) and the
 * Identification panel beside a record being made, so the two can never disagree about what
 * choosing a contact does to the draft.
 */
import type { CountryCode } from "libphonenumber-js/min";
import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
import {
  entityKindFromIdentifier,
  readDirectoryContactPoints,
} from "$lib/directory/directory-api.ts";
import { formatPhoneAsTyped } from "$lib/directory/phone-entry.ts";
import type { LogDraft } from "./log-draft.ts";

/**
 * The selection a contact field shows at rest.
 *
 * The kind comes from the handle's own prefix rather than from a read: a directory handle is minted
 * `directoryPerson_…` or `directoryOrganization_…`, so the glyph beside the name is right without
 * asking the server anything. Until the name lands the field says what it holds rather than printing
 * the handle, which is not an answer anybody can use.
 */
export function contactSelectionOf(draft: LogDraft): PickableEntity | null {
  if (draft.counterpartyEntityId === null) return null;
  return {
    identifier: draft.counterpartyEntityId,
    name: draft.counterpartyName ?? "This contact",
    kind: entityKindFromIdentifier(draft.counterpartyEntityId) ?? "person",
  };
}

/**
 * The number the chosen contact answers on, where the number is still empty.
 *
 * It never OVERWRITES a number somebody typed: which number a call actually came from is a fact
 * about the call, and a contact's record is a list of the ways they can be reached rather than a
 * statement about this one. A read that fails leaves the number exactly as it was.
 */
async function fillNumberFrom(draft: LogDraft, entityId: string): Promise<void> {
  if (draft.counterpartyNumber.trim() !== "") return;
  const outcome = await readDirectoryContactPoints(fetch, entityId);
  if (outcome.kind !== "ok") return;
  const reachable = outcome.value.phones.filter(
    (phone) => phone.contactSystem === "voice" || phone.contactSystem === "sms",
  );
  const chosen = reachable.find((phone) => phone.isPrimary) ?? reachable[0];
  if (chosen === undefined) return;
  // Still empty when the answer lands, or somebody has typed while it was in flight and theirs wins.
  if (draft.counterpartyNumber.trim() !== "") return;
  if (chosen.countryRegionCode !== null) draft.region = chosen.countryRegionCode;
  draft.counterpartyNumber = formatPhoneAsTyped(draft.region as CountryCode, chosen.number);
  // The contact's own extension comes with it. It is part of how they are reached, and a person who
  // has to retype it beside a number the platform just filled in will not.
  if (chosen.extension !== null) draft.counterpartyExtension = chosen.extension;
}

/** Record who the call or text was with, and offer their number where none has been typed. */
export function chooseContact(draft: LogDraft, entity: PickableEntity): void {
  draft.counterpartyEntityId = entity.identifier;
  draft.counterpartyName = entity.name;
  void fillNumberFrom(draft, entity.identifier);
}

/** Forget who it was with. The number stays: it is what the call came from either way. */
export function clearContact(draft: LogDraft): void {
  draft.counterpartyEntityId = null;
  draft.counterpartyName = null;
}
