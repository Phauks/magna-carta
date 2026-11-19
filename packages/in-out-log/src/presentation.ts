import type { InOutEntryRecipientRow, InOutEntryRow } from "./entry-statements.ts";

// How an entry leaves the API: the stored row and its recipients, shaped as the contract's
// InOutEntry. Kept beside the statements so a column rename meets its one reader here.

export interface InOutEntryView {
  id: string;
  number: string;
  description: string;
  from: { kind: InOutEntryRow["from_kind"]; userId: string | null; entityId: string | null; name: string };
  to: { id: string; kind: InOutEntryRecipientRow["kind"]; userId: string | null; entityId: string | null; name: string }[];
  matter: { id: string; title: string; number: string | null } | null;
  keptAt: string | null;
  notes: string | null;
  status: InOutEntryRow["status"];
  droppedOffAt: string;
  recordedByUserId: string;
  pickedUp: {
    at: string;
    by: { kind: InOutEntryRow["from_kind"]; userId: string | null; entityId: string | null; name: string };
    identityChecked: boolean;
    handedOverByUserId: string | null;
  } | null;
  movedToCustodian: {
    at: string;
    packetId: string;
    custodyNumber: string | null;
    movedByUserId: string | null;
  } | null;
}

export function presentEntry(
  row: InOutEntryRow,
  recipients: readonly InOutEntryRecipientRow[],
): InOutEntryView {
  return {
    id: row.id,
    number: row.number,
    description: row.description,
    from: { kind: row.from_kind, userId: row.from_user_id, entityId: row.from_entity_id, name: row.from_name },
    to: recipients
      .filter((recipient) => recipient.entry_id === row.id)
      .toSorted((left, right) => left.position - right.position)
      .map((recipient) => ({
        id: recipient.id,
        kind: recipient.kind,
        userId: recipient.user_id,
        entityId: recipient.entity_id,
        name: recipient.name,
      })),
    matter:
      row.matter_id === null
        ? null
        : { id: row.matter_id, title: row.matter_title ?? "", number: row.matter_number },
    keptAt: row.kept_at,
    notes: row.notes,
    status: row.status,
    droppedOffAt: row.dropped_off_at,
    recordedByUserId: row.recorded_by_user_id,
    pickedUp:
      row.status === "picked_up" && row.picked_up_at !== null && row.picked_up_by_kind !== null
        ? {
            at: row.picked_up_at,
            by: {
              kind: row.picked_up_by_kind,
              userId: row.picked_up_by_user_id,
              entityId: row.picked_up_by_entity_id,
              name: row.picked_up_by_name ?? "",
            },
            identityChecked: row.identity_checked === 1,
            handedOverByUserId: row.handed_over_by_user_id,
          }
        : null,
    movedToCustodian:
      row.status === "moved_to_custodian" && row.moved_to_custodian_at !== null && row.custody_packet_id !== null
        ? {
            at: row.moved_to_custodian_at,
            packetId: row.custody_packet_id,
            custodyNumber: row.custody_number,
            movedByUserId: row.moved_by_user_id,
          }
        : null,
  };
}

// The keyset cursor: the last row's drop-off instant and id, opaque to the caller.
export function encodeEntryCursor(row: Pick<InOutEntryRow, "dropped_off_at" | "id">): string {
  return btoa(JSON.stringify([row.dropped_off_at, row.id]));
}

export function decodeEntryCursor(cursor: string): { droppedOffAt: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(atob(cursor));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { droppedOffAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // A cursor that does not decode is treated as no cursor's page: refused by the caller.
  }
  return null;
}
