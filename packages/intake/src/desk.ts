import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { readMatterClientEntityIds } from "@magna-carta/matters/matter-party";
import { listMatters, type Page } from "@magna-carta/matters/queries";
import { readIntakeChecklist, type IntakeStepReaders } from "./checklist.ts";

// The intake desk: every intake the firm has in flight, and where each stands.
//
// AN INTAKE IN FLIGHT IS A MATTER IN THE INTAKE STATUS. Nothing else. A receptionist who starts an
// intake records the matter (no number of any kind yet), the intake procedure's checklist is derived
// over it, and when every required step is answered it GRADUATES to a consultation and draws its
// consultation number. The desk lists both rungs — the intakes still clearing their procedure and
// the consultations awaiting their meeting — and a matter leaves it the moment it opens or closes.
// So the desk is a READING of the matters the firm already holds, never a register of its own.
//
// THE DESK IS FIRM-WIDE, by the owner's direction of 2026-09-05 ("multiple intakes can happen at the
// same time, and they can be resumed"): a receptionist takes the call, a paralegal sends the forms, an
// attorney answers the conflicts step, and each of them has to find the same intake. The per-attorney
// Consultations view is unchanged and reads the same rows through its own filter.
//
// THE CHECKLIST STANDING COSTS ONE CHECKLIST READ PER ROW, which is why the page is capped at a
// number a desk can actually look at rather than the listing's general ceiling: the standing is
// derived from several subsystems and a member's records, and nothing stores it (the checklist's own
// rule). The names beside the rows — the responsible member, the matter type, the client — are one
// batched read each, never one per row.

export const MAX_DESK_PAGE_SIZE = 50;
export const DEFAULT_DESK_PAGE_SIZE = 25;

export interface DeskChecklistStanding {
  // Whether any active procedure binds this consultation's kind at all. A desk that showed "0 of 0
  // answered" for a kind with no procedure would read as a clean bill rather than an absence.
  readonly bound: boolean;
  readonly steps: number;
  readonly answered: number;
  readonly outstandingRequired: number;
}

export interface DeskConsultationSetting {
  readonly eventId: string;
  readonly title: string;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly timeZone: string;
}

export interface DeskRow {
  readonly matterId: string;
  readonly title: string;
  readonly status: "intake" | "consultation";
  readonly consultationNumber: string | null;
  readonly matterTypeId: string | null;
  readonly matterTypeName: string | null;
  readonly responsibleMemberId: string;
  readonly responsibleMemberName: string | null;
  readonly clientEntityId: string | null;
  readonly clientDisplayName: string | null;
  readonly createdAt: string;
  readonly isStale: boolean;
  readonly checklist: DeskChecklistStanding;
  // The next consultation still to happen on this intake, or null when none is scheduled. The
  // owner's workflow ends an intake by scheduling the consultation, so the desk says whether it has.
  readonly nextConsultation: DeskConsultationSetting | null;
}

export interface ReadIntakeDeskParams {
  readonly search?: string;
  readonly cursor?: string;
  readonly pageSize?: number;
  // ISO instant: the staleness reference and the "next" boundary. The read takes no clock of its own.
  readonly now: string;
  readonly staleAgeDays: number;
}

const MS_PER_DAY = 86_400_000;
// Cloudflare D1 binds at most 100 parameters per statement (the same cap matter-party.ts states).
const IN_LIST_CHUNK = 100;

async function readNamesByHandle(
  database: SqlDatabase,
  sql: (placeholders: string) => string,
  handles: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const distinct = [...new Set(handles)];
  for (let start = 0; start < distinct.length; start += IN_LIST_CHUNK) {
    const chunk = distinct.slice(start, start + IN_LIST_CHUNK);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(sql(placeholders))
      .bind(...chunk)
      .all<{ handle: string; name: string }>();
    for (const row of results) names.set(row.handle, row.name);
  }
  return names;
}

// The earliest scheduled event on or after today, per matter, in one read per chunk. "Today" is the
// civil date of `now` read as UTC — a desk that hid a consultation set for this afternoon because of
// a zone would be worse than one that shows this morning's for an hour longer.
async function readNextSettings(
  database: SqlDatabase,
  matterIds: readonly string[],
  today: string,
): Promise<Map<string, DeskConsultationSetting>> {
  const next = new Map<string, DeskConsultationSetting>();
  for (let start = 0; start < matterIds.length; start += IN_LIST_CHUNK - 1) {
    const chunk = matterIds.slice(start, start + IN_LIST_CHUNK - 1);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map((_, index) => `?${index + 2}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT id, matter_id, title, starts_on, starts_at_time, time_zone FROM matter_event
          WHERE status = 'scheduled' AND starts_on >= ?1 AND matter_id IN (${placeholders})
          ORDER BY starts_on ASC, starts_at_time ASC, id ASC`,
      )
      .bind(today, ...chunk)
      .all<{
        id: string;
        matter_id: string;
        title: string;
        starts_on: string;
        starts_at_time: string | null;
        time_zone: string;
      }>();
    for (const row of results) {
      if (next.has(row.matter_id)) continue;
      next.set(row.matter_id, {
        eventId: row.id,
        title: row.title,
        startsOn: row.starts_on,
        startsAtTime: row.starts_at_time,
        timeZone: row.time_zone,
      });
    }
  }
  return next;
}

export async function readIntakeDesk(
  database: SqlDatabase,
  readers: IntakeStepReaders,
  params: ReadIntakeDeskParams,
): Promise<Page<DeskRow>> {
  const pageSize = Math.min(params.pageSize ?? DEFAULT_DESK_PAGE_SIZE, MAX_DESK_PAGE_SIZE);
  const page = await listMatters(database, {
    // Both rungs before opening: an intake still clearing its procedure, and a consultation that
    // has cleared it and awaits its meeting. The row says which.
    statuses: ["intake", "consultation"],
    search: params.search,
    cursor: params.cursor,
    pageSize,
  });
  const matterIds = page.data.map((matter) => matter.id);
  const threshold = new Date(
    new Date(params.now).getTime() - params.staleAgeDays * MS_PER_DAY,
  ).toISOString();
  const today = params.now.slice(0, 10);

  const [clientByMatter, memberNames, typeNames, nextSettings] = await Promise.all([
    readMatterClientEntityIds(database, matterIds),
    readNamesByHandle(
      database,
      (placeholders) =>
        `SELECT user_id AS handle, display_name AS name FROM member WHERE user_id IN (${placeholders})`,
      page.data.map((matter) => matter.responsibleMemberId),
    ),
    readNamesByHandle(
      database,
      (placeholders) => `SELECT id AS handle, name FROM matter_type WHERE id IN (${placeholders})`,
      page.data.flatMap((matter) => (matter.matterTypeId === null ? [] : [matter.matterTypeId])),
    ),
    readNextSettings(database, matterIds, today),
  ]);

  const rows: DeskRow[] = [];
  for (const matter of page.data) {
    const checklist = await readIntakeChecklist(database, matter.id as MatterId, readers);
    rows.push({
      matterId: matter.id,
      title: matter.title,
      status: matter.status === "intake" ? "intake" : "consultation",
      consultationNumber: matter.consultationNumber,
      matterTypeId: matter.matterTypeId,
      matterTypeName:
        matter.matterTypeId === null ? null : (typeNames.get(matter.matterTypeId) ?? null),
      responsibleMemberId: matter.responsibleMemberId,
      responsibleMemberName: memberNames.get(matter.responsibleMemberId) ?? null,
      clientEntityId: clientByMatter.get(matter.id) ?? null,
      clientDisplayName: matter.clientDisplayName,
      createdAt: matter.createdAt,
      isStale: matter.createdAt <= threshold,
      checklist: {
        bound: checklist.procedures.length > 0,
        steps: checklist.steps.length,
        answered: checklist.steps.filter((step) => step.standing.satisfied).length,
        outstandingRequired: checklist.outstandingRequired,
      },
      nextConsultation: nextSettings.get(matter.id) ?? null,
    });
  }
  return { data: rows, nextCursor: page.nextCursor };
}
