import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  FileId,
  FileVersionId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { readAttachableFile } from "./exhibit-statements.ts";
import { labelFor } from "./label.ts";
import { EXHIBIT_SET_MEMBER_TABLE } from "./member-statements.ts";
import { readExhibitSet } from "./queries.ts";
import { EXHIBIT_SET_TABLE, schemeOf, readExhibitSetRow } from "./set-statements.ts";
import { assertDraft } from "./set-service.ts";
import type { ExhibitDisposition, ExhibitServiceOptions } from "./types.ts";
import { ExhibitValidationError, assertCivilDate, assertDisposition } from "./validation.ts";

// ISSUING: a member records that a set went out — filed, served, exchanged or lodged — and every
// label, title and file version on it freezes.
//
// It is an ASSERTION. The platform has no court e-filing integration and does not pretend to observe
// a filing, so issuing records what a person says happened, when they say it happened, and who said
// so. It is irreversible: the database refuses to move a set out of 'issued', and an amended filing
// is a new set that supersedes this one (supersession-service.ts).
//
// THIS IS THE ONLY PLACE exhibit_set_member.label IS EVER WRITTEN. Until now every label was
// computed; here the computed labels are written down, in the same batch that flips the set's state,
// so there is no moment at which a set is issued with a label missing.

export const ISSUE_GUARD = "exhibit-set-issue-current";

export interface IssueExhibitSetInput {
  readonly disposition: unknown;
  /** The civil date the member says the set went out. */
  readonly issuedOn: unknown;
  /** The court-stamped or as-served copy, when the member has it. */
  readonly filedCopyFileId?: FileId | null;
}

interface IssuedMemberValues {
  readonly id: ExhibitSetMemberId;
  readonly label: string;
  readonly title: string;
  readonly fileVersionId: FileVersionId;
}

export async function issueExhibitSet(
  database: SqlDatabase,
  matterId: MatterId,
  setId: ExhibitSetId,
  input: IssueExhibitSetInput,
  options: ExhibitServiceOptions,
): Promise<{
  labels: readonly { memberId: ExhibitSetMemberId; label: string }[];
  effect: EffectWrite;
}> {
  const disposition: ExhibitDisposition = assertDisposition(input.disposition);
  const issuedOn = assertCivilDate(input.issuedOn, "issuedOn");
  const set = await readExhibitSet(database, matterId, setId);
  if (set === undefined) {
    throw new ExhibitValidationError("exhibit-unknown-set", "no such exhibit set on this matter");
  }
  const row = await readExhibitSetRow(database, setId);
  if (row === undefined) {
    throw new ExhibitValidationError("exhibit-unknown-set", "no such exhibit set on this matter");
  }
  assertDraft(row);
  if (set.members.length === 0) {
    throw new ExhibitValidationError("exhibit-set-empty", "a set with no exhibits cannot be issued");
  }

  const filedCopyFileId = input.filedCopyFileId ?? null;
  if (filedCopyFileId !== null) {
    const file = await readAttachableFile(database, filedCopyFileId);
    if (file === undefined || file.matterId !== matterId || !file.currentVersionClean) {
      throw new ExhibitValidationError(
        "exhibit-file-unavailable",
        "the filed copy must be a clean file on this matter",
      );
    }
  }

  // Each member freezes on the version it would issue now: the pinned one, or the file's current
  // clean version for a floating exhibit. A member with neither is refused by position rather than
  // issued pointing at nothing.
  const scheme = schemeOf(row);
  const values: IssuedMemberValues[] = [];
  for (const member of set.members) {
    const fileVersionId =
      member.pinnedFileVersionId ?? (await cleanCurrentVersion(database, member.fileId));
    if (fileVersionId === null) {
      throw new ExhibitValidationError(
        "exhibit-file-unavailable",
        `the document at position ${member.position} has no clean version to issue`,
      );
    }
    values.push({
      id: member.id,
      label: labelFor(member.position, scheme),
      title: member.title,
      fileVersionId,
    });
  }

  const now = options.clock.now();
  const payload = JSON.stringify(values);
  return {
    labels: values.map((value) => ({ memberId: value.id, label: value.label })),
    effect: {
      statements: [
        // Every member at once, from the payload, while the set is still a draft. Guarded on the
        // payload still naming every member, so one added since the read refuses the batch.
        guarded(
          database
            .prepare(
              `UPDATE ${EXHIBIT_SET_MEMBER_TABLE} SET ` +
                `label = (SELECT json_extract(value, '$.label') FROM json_each(?2) ` +
                `WHERE json_extract(value, '$.id') = ${EXHIBIT_SET_MEMBER_TABLE}.id), ` +
                `title_as_issued = (SELECT json_extract(value, '$.title') FROM json_each(?2) ` +
                `WHERE json_extract(value, '$.id') = ${EXHIBIT_SET_MEMBER_TABLE}.id), ` +
                `file_version_id_as_issued = (SELECT json_extract(value, '$.fileVersionId') ` +
                `FROM json_each(?2) WHERE json_extract(value, '$.id') = ${EXHIBIT_SET_MEMBER_TABLE}.id), ` +
                `updated_at = ?3 WHERE exhibit_set_id = ?1 ` +
                `AND (SELECT COUNT(*) FROM ${EXHIBIT_SET_MEMBER_TABLE} WHERE exhibit_set_id = ?1) = ` +
                `json_array_length(?2) ` +
                `AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
            )
            .bind(setId, payload, now),
          ISSUE_GUARD,
        ),
        // Then the set, guarded on still being a draft with every member labelled.
        guarded(
          database
            .prepare(
              `UPDATE ${EXHIBIT_SET_TABLE} SET state = 'issued', disposition = ?2, issued_on = ?3, ` +
                `issued_at = ?4, issued_by = ?5, filed_copy_file_id = ?6, updated_at = ?4 ` +
                `WHERE id = ?1 AND state = 'draft' AND NOT EXISTS (SELECT 1 FROM ` +
                `${EXHIBIT_SET_MEMBER_TABLE} WHERE exhibit_set_id = ?1 AND label IS NULL)`,
            )
            .bind(setId, disposition, issuedOn, now, options.actorUserId, filedCopyFileId),
          ISSUE_GUARD,
        ),
        domainAuditStatement(database, {
          event: "exhibitSet.issued",
          subjectId: setId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId, disposition, memberCount: values.length, filedCopyFileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function cleanCurrentVersion(
  database: SqlDatabase,
  fileId: FileId,
): Promise<FileVersionId | null> {
  const file = await readAttachableFile(database, fileId);
  return file !== undefined && file.currentVersionClean ? file.currentVersionId : null;
}
