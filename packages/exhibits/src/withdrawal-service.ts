import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { ExhibitSetId, ExhibitSetMemberId, MatterId } from "@magna-carta/identifiers/types";
import { EXHIBIT_SET_MEMBER_TABLE, readMemberRows } from "./member-statements.ts";
import { requireSet } from "./set-service.ts";
import type { ExhibitServiceOptions } from "./types.ts";
import { ExhibitValidationError, assertBasis } from "./validation.ts";

// Withdrawing one exhibit from an issued set. The label is RETIRED, not freed: the member keeps its
// label and its position, the position stays a hole in the order, and no later member of the set or
// of a set continuing from it ever takes the label. Two documents both correctly cited as
// "Exhibit C" is a collision no reader can resolve.

export const WITHDRAW_GUARD = "exhibit-member-active";

export async function withdrawMember(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  memberId: ExhibitSetMemberId,
  input: { readonly basis: unknown },
  options: ExhibitServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const basis = assertBasis(input.basis);
  const set = await requireSet(database, matterId, setId);
  if (set.state !== "issued") {
    throw new ExhibitValidationError(
      "exhibit-set-not-issued",
      "only an issued set has members to withdraw; remove it from the draft instead",
    );
  }
  const member = (await readMemberRows(database, setId)).find((row) => row.id === memberId);
  if (member === undefined) {
    throw new ExhibitValidationError("exhibit-unknown-member", "no such member in this set");
  }
  if (member.status === "withdrawn") {
    throw new ExhibitValidationError("exhibit-member-withdrawn", "that exhibit is already withdrawn");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          database
            .prepare(
              `UPDATE ${EXHIBIT_SET_MEMBER_TABLE} SET status = 'withdrawn', withdrawn_at = ?2, ` +
                `withdrawn_by = ?3, withdrawal_basis = ?4, updated_at = ?2 ` +
                `WHERE id = ?1 AND status = 'active'`,
            )
            .bind(memberId, now, options.actorUserId, basis),
          WITHDRAW_GUARD,
        ),
        domainAuditStatement(database, {
          event: "exhibitSet.memberWithdrawn",
          subjectId: memberId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, setId, exhibitId: member.matter_exhibit_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}
