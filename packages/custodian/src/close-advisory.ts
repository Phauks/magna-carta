import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import type {
  CloseAdvisory,
  CloseAdvisoryContext,
  CloseAdvisoryNotice,
} from "@magna-carta/matters/close-advisories";

// The matter-close notice. Closing a matter SURFACES the custody packets linked to it and never,
// under any condition, blocks the close.
//
// This is an advisory rather than a precondition, and the difference is a decision rather than an
// omission. Trust's close rule is a hard block because a closed matter with somebody else's money in
// it is how funds become unclaimed and the firm that closed it has to answer for them. Custody is the
// opposite case: a firm holds a client's original will for decades after the last matter for that
// client closed, and that is the STEADY STATE of a safe-custody register, not a loose end. A packet's
// tenancy root is the firm, not a matter, and a packet may have no matter at all. Blocking the close
// would teach firms to unlink packets from matters before closing them, which would destroy the
// connection this notice exists to draw attention to.
//
// So the notice says what is there, points at where to act on it, and gets out of the way.

export const CUSTODY_PACKETS_LINKED_TO_MATTER = "custody-packets-linked";

// The count only — no custody number, no packet name, no owner. Closing a matter needs no custody
// permission, and the register is a list of the most sensitive things a firm holds: that the firm
// holds an original will for a named person is a disclosure with no document attached. A person
// entitled to the detail reads it in the register, which is where the permission is checked.
export async function readLinkedCustodyPacketCount(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<number> {
  // `.all()` + `results[0]`, never `.first()` — the one-row read convention (one sentinel for "no
  // row"), stated in packages/data-access/src/idempotency-statements.ts.
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS linked_count FROM custody_packet WHERE matter_id = ?1 AND status IN ('held', 'out')`,
    )
    .bind(matterId)
    .all<{ linked_count: number }>();
  return results[0]?.linked_count ?? 0;
}

async function notice(context: CloseAdvisoryContext): Promise<readonly CloseAdvisoryNotice[]> {
  const linked = await readLinkedCustodyPacketCount(context.database, context.matterId);
  if (linked === 0) return [];
  return [
    {
      code: CUSTODY_PACKETS_LINKED_TO_MATTER,
      message:
        linked === 1
          ? "The firm still holds 1 packet of physical property linked to this matter. Closing the matter does not change where that property is, who it is held for, or what the register says about it — the safe-custody register lists it, and it stays there until somebody moves, releases, or destroys it."
          : `The firm still holds ${linked} packets of physical property linked to this matter. Closing the matter does not change where that property is, who it is held for, or what the register says about it — the safe-custody register lists them, and they stay there until somebody moves, releases, or destroys them.`,
    },
  ];
}

// What the composition root registers against the matter shell's close-advisory hook.
export const matterCustodyCloseAdvisory: CloseAdvisory = { notice };
