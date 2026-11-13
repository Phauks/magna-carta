import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  FileVersionId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { isCleanVersionOf, readMatterExhibit } from "./exhibit-statements.ts";
import { EXHIBIT_SET_MEMBER_TABLE, readMemberRows } from "./member-statements.ts";
import { requireSet } from "./set-service.ts";
import type { ExhibitServiceOptions } from "./types.ts";
import { ExhibitValidationError, assertBasis, assertTitle } from "./validation.ts";

// Correcting the RECORD of an issued member: the title was mistyped, or the wrong version was
// recorded as the one that went out. A firm has to be able to fix its own record of what it filed.
//
// STRUCTURALLY UNABLE TO RENUMBER. The one statement here writes the correction columns and nothing
// else — no label, no position — and it writes them BESIDE the as-issued values, which stay as they
// were, so the record keeps both what the platform said at issue and what it says now. Every
// correction is audited with the member who made it and why.

export interface CorrectMemberInput {
  readonly title?: unknown;
  readonly fileVersionId?: FileVersionId;
  readonly basis: unknown;
}

export async function correctMember(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  memberId: ExhibitSetMemberId,
  input: CorrectMemberInput,
  options: ExhibitServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const basis = assertBasis(input.basis);
  if (input.title === undefined && input.fileVersionId === undefined) {
    throw new ExhibitValidationError(
      "exhibit-invalid-input",
      "a correction names a title, a file version, or both",
    );
  }
  const set = await requireSet(database, matterId, setId);
  if (set.state !== "issued") {
    throw new ExhibitValidationError(
      "exhibit-set-not-issued",
      "a draft is edited directly; only an issued set's record is corrected",
    );
  }
  const member = (await readMemberRows(database, setId)).find((row) => row.id === memberId);
  if (member === undefined) {
    throw new ExhibitValidationError("exhibit-unknown-member", "no such member in this set");
  }
  const title = input.title === undefined ? member.corrected_title : assertTitle(input.title);
  let fileVersionId = member.corrected_file_version_id;
  if (input.fileVersionId !== undefined) {
    const exhibit = await readMatterExhibit(database, member.matter_exhibit_id);
    if (
      exhibit === undefined ||
      !(await isCleanVersionOf(database, exhibit.file_id, input.fileVersionId))
    ) {
      throw new ExhibitValidationError(
        "exhibit-file-unavailable",
        "the corrected version must be a clean version of the exhibit's file",
      );
    }
    fileVersionId = input.fileVersionId;
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        database
          .prepare(
            `UPDATE ${EXHIBIT_SET_MEMBER_TABLE} SET corrected_title = ?2, ` +
              `corrected_file_version_id = ?3, corrected_at = ?4, corrected_by = ?5, ` +
              `correction_basis = ?6, updated_at = ?4 WHERE id = ?1`,
          )
          .bind(memberId, title, fileVersionId, now, options.actorUserId, basis),
        domainAuditStatement(database, {
          event: "exhibitSet.memberCorrected",
          subjectId: memberId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId,
            setId,
            correctedTitle: input.title !== undefined,
            previousFileVersionId: member.corrected_file_version_id ?? member.file_version_id_as_issued,
            fileVersionId,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}
