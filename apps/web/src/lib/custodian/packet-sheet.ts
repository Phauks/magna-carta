/*
 * A packet as one printed sheet.
 *
 * A custody register is a thing a firm prints: a client asks what is held for them, a partner takes
 * a page to a completion meeting, an auditor asks for the record of an original. The sheet is
 * therefore the register's own account of the packet — what it is, where it is, whom it is held
 * for, what stands against it, and the whole chain of custody — and it is DATA, so nothing that is
 * not on this list can reach the paper.
 *
 * WHAT IS DELIBERATELY NOT ON IT. No declared value: it is a business number about an object, it is
 * on the screen for the firm's own risk picture, and a printed sheet leaves the building. No
 * identity evidence typed against a release either, for the same reason plus a stronger one — it is
 * an assertion about a check somebody made, frozen on a row that can never be edited, and it has no
 * business on a page anyone can be handed. The authority a release stood on IS printed, because it
 * is the answer to the question a printed custody record is asked.
 */
import type { PrintSheetDocument, PrintSheetSection } from "@magna-carta/design-system/print-sheet";
import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
import type { CustodyPacketDetail } from "./custody-api.ts";
import {
  holdLabel,
  itemStatusEntry,
  packetStatusEntry,
  type CustodyItemStatus,
} from "./custody-vocabulary.ts";
import { holdsInForce } from "./release-gate.ts";

/** What stands where the register recorded nothing. It states the gap rather than filling it. */
const NOT_RECORDED = "Not recorded";

/** The breadcrumb of the packet's current node, root first. */
export function locationBreadcrumb(packet: CustodyPacketDetail): string {
  if (packet.locationPath.length === 0) return NOT_RECORDED;
  return packet.locationPath.map((node) => node.name).join(" / ");
}

/** One item's line: what it is, its own state, and the instrument's own date where it has one. */
function itemLine(description: string, status: CustodyItemStatus, instrumentDate: string | null) {
  const dated = instrumentDate === null ? "" : ` dated ${instrumentDate}`;
  return `${description}${dated} — ${itemStatusEntry(status).label}`;
}

/**
 * The packet's printable sheet.
 *
 * `ownerNames` is what the surface resolved through the directory, by handle. A handle it could not
 * name prints as the gap, never as the handle: a printed page carrying `directoryPerson_01J…` is
 * worse than one that says the name was not available.
 */
export function packetPrintSheet(
  packet: CustodyPacketDetail,
  ownerNames: (entityId: string) => string | null,
  history: readonly EventRailEvent[],
): PrintSheetDocument {
  const standing = holdsInForce(packet.holds);
  const sections: PrintSheetSection[] = [
    {
      kind: "fields",
      id: "standing",
      title: "Standing",
      fields: [
        { label: "Status", value: packetStatusEntry(packet.status).label },
        { label: "Location", value: locationBreadcrumb(packet) },
        { label: "Deposited", value: packet.depositedAt ?? NOT_RECORDED },
        { label: "Next review", value: packet.reviewOn ?? "None scheduled" },
        {
          label: "Custody number",
          value: packet.custodyNumber,
          secondary: packet.numberSource === "manual" ? "Carried in, not drawn" : undefined,
        },
      ],
    },
    {
      kind: "fields",
      id: "owners",
      title: "Held for",
      fields:
        packet.owners.length === 0
          ? [{ label: "Owner", value: NOT_RECORDED }]
          : packet.owners.map((owner) => ({
              label: owner.ownershipRole ?? "Owner",
              value: ownerNames(owner.entityId) ?? NOT_RECORDED,
              secondary: owner.effectiveTo === null ? undefined : `Ended ${owner.effectiveTo}`,
            })),
    },
    {
      kind: "fields",
      id: "contents",
      title: "Contents",
      fields:
        packet.items.length === 0
          ? [{ label: "Contents", value: "Not yet described" }]
          : packet.items.map((item) => ({
              label: `Item ${item.ordinal}`,
              value: itemLine(item.description, item.status, item.instrumentDate),
              secondary: item.intrinsicValue ? "Irreplaceable original" : undefined,
            })),
    },
  ];

  if (standing.length > 0) {
    sections.push({
      kind: "fields",
      id: "holds",
      title: "Holds in force",
      fields: standing.map((hold) => ({
        label: holdLabel(hold.kind),
        value: hold.reason ?? "No reason recorded",
        secondary: `Placed ${hold.placedAt}`,
      })),
    });
  }

  if (packet.notes !== null && packet.notes.trim() !== "") {
    sections.push({ kind: "text", id: "notes", title: "Notes", text: packet.notes });
  }

  sections.push({ kind: "history", id: "history", title: "Chain of custody", events: history });

  return {
    heading: "Custody Packet",
    reference: packet.custodyNumber,
    subtitle: packet.name,
    sections,
  };
}
