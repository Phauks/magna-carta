import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyItemId,
  CustodyPacketId,
  CustodyScanId,
  FileId,
  MatterId,
} from "@magna-carta/identifiers/types";
import {
  readSystemMatterId,
  SYSTEM_MATTER_KEYS,
} from "@magna-carta/matters/system-matter-statements";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import { readCustodyItem, readCustodyPacket } from "./packet-statements.ts";
import { insertCustodyScanStatement, readFileMatter } from "./scan-statements.ts";
import type { CustodyScanKind } from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// Scanned copies are a LINK over ordinary File Manager files, and this module holds no byte path at
// all: the bytes reach `clean` through the File Manager's existing presigned upload and quarantine
// chokepoint, and there is no upload route in Custodian. That is what buys a custody scan preview,
// conversion, search, bundling, and holds for free — duplicating the File Manager for it would mean
// duplicating six subsystems' worth of consumer behaviour, and the second copy is the one that lags.
//
// A scan is never a substitute for the original and satisfies no gate. "We have a scan" is precisely
// the reasoning that destroys an original will, so the destruction refusals read the item's
// intrinsic-value flag and never the presence of a scan.

export interface CustodyScanServiceOptions extends CustodyAuditContext {
  readonly randomSource?: RandomSource;
}

export interface LinkCustodyScanInput {
  readonly fileId: FileId;
  readonly kind: CustodyScanKind;
  readonly itemId?: CustodyItemId | null;
  readonly capturedAt?: string;
}

// Where a packet's scans are filed: its own matter when it has one, and the firm's custody holding
// matter when it does not. Read-only — the holding matter is created when the matterless packet is
// logged, so by the time anyone links a scan the target already exists.
export async function resolveCustodyFilingMatter(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<MatterId | undefined> {
  const packet = await readCustodyPacket(database, packetId);
  if (packet === undefined) return undefined;
  if (packet.matter_id !== null) return packet.matter_id;
  return readSystemMatterId(database, SYSTEM_MATTER_KEYS.custodyHolding);
}

export async function linkCustodyScan(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  input: LinkCustodyScanInput,
  options: CustodyScanServiceOptions,
): Promise<{ scanId: CustodyScanId; effect: EffectWrite }> {
  const packet = await readCustodyPacket(database, packetId);
  if (packet === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-packet",
      `no such custody packet: ${packetId}`,
    );
  }
  if (input.itemId != null) {
    const item = await readCustodyItem(database, input.itemId);
    if (item === undefined || item.packet_id !== packetId) {
      throw new CustodyValidationError(
        "custody-unknown-item",
        "the item named for this scan does not belong to this packet",
      );
    }
  }
  const stored = await readFileMatter(database, input.fileId);
  if (stored === undefined) {
    throw new CustodyValidationError(
      "custody-scan-file-not-filed-here",
      "no such file in this firm — upload the scan through the ordinary file path first",
    );
  }
  const filingMatterId = await resolveCustodyFilingMatter(database, packetId);
  // A file handle alone must not be enough to attach a document to a packet: a file filed on another
  // matter is somebody else's record, and linking it here would quietly widen who can see it through
  // the register. A file from another FIRM is already unreachable — the database handle is
  // firm-scoped — but the filing check is asserted rather than assumed.
  if (filingMatterId === undefined || stored.matter_id !== filingMatterId) {
    throw new CustodyValidationError(
      "custody-scan-file-not-filed-here",
      "this file is not filed where this packet's scans belong",
    );
  }

  const scanId = newIdentifier("custodyScan", options.randomSource);
  const now = options.clock.now();
  return {
    scanId,
    effect: {
      statements: [
        insertCustodyScanStatement(database, {
          id: scanId,
          packetId,
          itemId: input.itemId ?? null,
          fileId: input.fileId,
          kind: input.kind,
          capturedAt: input.capturedAt ?? now,
          capturedBy: options.actorUserId,
          createdAt: now,
        }),
        custodyAuditStatement(database, options, "custodyScan.linked", scanId, {
          packetId,
          fileId: input.fileId,
          kind: input.kind,
        }),
      ],
      outboxMessages: [],
    },
  };
}
