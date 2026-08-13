import type { CommunityFlagId, FirmId, UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "../sql.ts";
import type { FlagReason, SubjectKind } from "../types.ts";
import { COMMUNITY_FLAG_TABLE } from "./tables.ts";

// A reader's report, and the place where the two moderation postures diverge.
//
// A confidentiality report hides its subject on the first one, from any signed-in reader. A spam or
// abuse report is counted, and only enough reports from enough SEPARATE firms hide anything —
// which is what stops one determined account, or one firm's worth of accounts, silencing a post
// they disagree with. The count is over distinct firms rather than over rows, and the unique index
// on (subject, reporter) is what makes each row a distinct person as well.

export function insertFlagStatement(
  database: SqlDatabase,
  input: {
    readonly id: CommunityFlagId;
    readonly subjectKind: SubjectKind;
    readonly subjectId: string;
    readonly reason: FlagReason;
    readonly note: string | null;
    readonly reporterUserId: UserId;
    readonly reporterFirmId: FirmId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_FLAG_TABLE}
         (id, subject_kind, subject_id, reason, note, reporter_user_id, reporter_firm_id, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', ?8)
       ON CONFLICT (subject_id, reporter_user_id) DO NOTHING`,
    )
    .bind(
      input.id,
      input.subjectKind,
      input.subjectId,
      input.reason,
      input.note,
      input.reporterUserId,
      input.reporterFirmId,
      input.now,
    );
}

// How many separate firms have reported this subject for spam or abuse. Confidentiality reports are
// excluded because they never wait for a threshold.
export function countDistinctReportingFirmsStatement(
  database: SqlDatabase,
  subjectId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(DISTINCT reporter_firm_id) AS firm_count
       FROM ${COMMUNITY_FLAG_TABLE}
       WHERE subject_id = ?1 AND status = 'open' AND reason IN ('spam', 'abuse')`,
    )
    .bind(subjectId);
}

// The operator's queue: everything open, oldest first, so nothing waits behind something newer.
export function listOpenFlagsStatement(database: SqlDatabase, limit: number): SqlStatement {
  return database
    .prepare(
      `SELECT id, subject_kind, subject_id, reason, note, status, created_at
       FROM ${COMMUNITY_FLAG_TABLE}
       WHERE status = 'open'
       ORDER BY
         -- Confidentiality first, always: everything else in this queue can wait a day and this
         -- cannot. Within a reason, oldest first.
         CASE reason WHEN 'confidentiality' THEN 0 ELSE 1 END ASC,
         created_at ASC
       LIMIT ?1`,
    )
    .bind(limit);
}

export function resolveFlagsForSubjectStatement(
  database: SqlDatabase,
  input: {
    readonly subjectId: string;
    readonly status: "upheld" | "cleared";
    readonly resolvedByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_FLAG_TABLE}
         SET status = ?2, resolved_at = ?3, resolved_by_user_id = ?4
       WHERE subject_id = ?1 AND status = 'open'`,
    )
    .bind(input.subjectId, input.status, input.now, input.resolvedByUserId);
}

// How many of a reporter's own reports were cleared rather than upheld. Repeat false flagging is
// visible on the account, which is what bounds abuse of the one-flag-hides mechanism without
// putting a threshold in front of it.
export function countClearedReportsByReporterStatement(
  database: SqlDatabase,
  reporterUserId: UserId,
): SqlStatement {
  return database
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'cleared' THEN 1 ELSE 0 END) AS cleared_count,
         COUNT(*) AS total_count
       FROM ${COMMUNITY_FLAG_TABLE}
       WHERE reporter_user_id = ?1`,
    )
    .bind(reporterUserId);
}
