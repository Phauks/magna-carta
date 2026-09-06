/*
 * The intake desk, as a model: what one intake in flight is to the reader, and what the desk may do
 * to it. Mirrors `intake.listConsultations` in apps/api-worker/openapi/openapi.json; the transport
 * envelope lives in $lib/api/request.ts.
 *
 * THE DESK HOLDS TWO RUNGS OF THE MATTER LIFECYCLE and nothing of its own: an INTAKE, still
 * clearing the firm's procedure, and a CONSULTATION, which the procedure let through and which
 * awaits its meeting. A matter leaves the desk when it opens or closes. An intake is resumed by
 * opening the matter's own Intake section, where every step stands in the words of whoever
 * answered it; it is COMPLETED from here, which draws its consultation number; and a consultation is
 * SCHEDULED from here.
 *
 * THE DESK STATES COUNTS, NEVER A VERDICT. "3 of 5 answered, 1 required outstanding" is a fact about
 * the firm's own procedure; nothing here summarises a checklist into a word about the client, and
 * the conflicts step's standing is a sentence on the matter's Intake section, not a mark here.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import { permissionRefusal } from "$lib/access/refusal.ts";
import { MANAGE_CALENDAR_PERMISSION } from "$lib/calendar/calendar-api.ts";
import { GRADUATE_MATTER_PERMISSION } from "$lib/matters/matters-api.ts";
import { matterStatusLabel } from "$lib/matters/matter-status.ts";

/** The two rungs the desk holds. */
export type IntakeDeskStatus = "intake" | "consultation";

export interface IntakeDeskChecklist {
  /** Whether any active procedure binds this consultation's kind. */
  bound: boolean;
  steps: number;
  answered: number;
  outstandingRequired: number;
}

export interface IntakeDeskConsultation {
  eventId: string;
  title: string;
  startsOn: string;
  startsAtTime: string | null;
  timeZone: string;
}

export interface IntakeDeskRow {
  matterId: string;
  status: IntakeDeskStatus;
  title: string;
  consultationNumber: string | null;
  matterTypeId: string | null;
  matterTypeName: string | null;
  responsibleMemberId: string;
  responsibleMemberName: string | null;
  clientEntityId: string | null;
  clientDisplayName: string | null;
  createdAt: string;
  /** Sat past the firm's stale-consultation age without opening or closing. */
  isStale: boolean;
  checklist: IntakeDeskChecklist;
  /** The next scheduled event on the intake, or null when the consultation is not on the calendar. */
  nextConsultation: IntakeDeskConsultation | null;
}

export interface IntakeDeskQuery {
  search?: string;
  cursor?: string;
}

export function listIntakeDesk(
  fetchImpl: typeof fetch,
  query: IntakeDeskQuery = {},
): Promise<ApiOutcome<Page<IntakeDeskRow>>> {
  const parameters = new URLSearchParams();
  const search = query.search?.trim() ?? "";
  if (search !== "") parameters.set("search", search);
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  const suffix = parameters.toString();
  return requestJson(fetchImpl, `/api/v1/intake/consultations${suffix === "" ? "" : `?${suffix}`}`);
}

/** Where an intake is resumed: the matter's own Intake section. */
export function intakeResumeHref(row: Pick<IntakeDeskRow, "matterId">): string {
  return `/matters/${encodeURIComponent(row.matterId)}/intake`;
}

/** The word the desk prints for a matter with no number yet: every intake, by construction. */
export const UNNUMBERED_INTAKE = "Unnumbered";

/**
 * How far an intake is, as the one line its row carries. Counts of the firm's own steps, and the
 * absence of a procedure stated as an absence rather than as nothing outstanding.
 */
export function intakeStandingText(
  checklist: IntakeDeskChecklist,
  status: IntakeDeskStatus = "intake",
): string {
  // A consultation has finished its intake, whatever the procedure says now: the record stood when
  // it graduated, and the desk does not re-grade it.
  if (status === "consultation") return "Intake complete";
  if (!checklist.bound) return "No procedure binds this kind of matter";
  const answered = `${String(checklist.answered)} of ${String(checklist.steps)} answered`;
  if (checklist.outstandingRequired === 0) return `${answered}, ready to complete`;
  return checklist.outstandingRequired === 1
    ? `${answered}, 1 required outstanding`
    : `${answered}, ${String(checklist.outstandingRequired)} required outstanding`;
}

/** Whether every required step is answered: what lets an intake complete. */
export function intakeComplete(checklist: IntakeDeskChecklist): boolean {
  return checklist.outstandingRequired === 0;
}

/** The two rungs' labels, from the one status register, for the Status column's filter. */
export const INTAKE_DESK_STATUS_LABELS: readonly string[] = (
  ["intake", "consultation"] as const
).map((status) => matterStatusLabel(status));

/**
 * Why the intake cannot be completed from this row, or undefined when it can.
 *
 * Completing an intake is the lifecycle step that makes it a consultation and draws its number, so
 * it carries the same authority as recording a consultation outright, and it is refused, naming how
 * many, while a required step is outstanding — the server holds the same door.
 */
export function completeRefusal(
  row: Pick<IntakeDeskRow, "status" | "checklist">,
  /** The session's permissions, or null while the session is still being read. */
  permissions: readonly string[] | null,
): string | undefined {
  // Not yet known is not the same as not held, and the line says which.
  if (permissions === null) return "Reading your session.";
  if (!permissions.includes(GRADUATE_MATTER_PERMISSION)) {
    return permissionRefusal("Completing the intake", GRADUATE_MATTER_PERMISSION);
  }
  if (row.status !== "intake") return "The intake is complete.";
  const outstanding = row.checklist.outstandingRequired;
  if (outstanding > 0) {
    return outstanding === 1
      ? "One required step is outstanding."
      : `${String(outstanding)} required steps are outstanding.`;
  }
  return undefined;
}

/**
 * Why the consultation cannot be scheduled from this row, or undefined when it can.
 *
 * The owner's workflow schedules the consultation once the intake is complete, so an intake still
 * in flight refuses it and says what comes first. A consultation already on the calendar is not
 * scheduled again from here; the row shows when it is, and the matter's Calendar moves it.
 */
export function scheduleRefusal(
  row: Pick<IntakeDeskRow, "status" | "nextConsultation">,
  /** The session's permissions, or null while the session is still being read. */
  permissions: readonly string[] | null,
): string | undefined {
  if (permissions === null) return "Reading your session.";
  if (!permissions.includes(MANAGE_CALENDAR_PERMISSION)) {
    return permissionRefusal("Scheduling the consultation", MANAGE_CALENDAR_PERMISSION);
  }
  if (row.status === "intake") {
    return "Complete the intake first. The consultation is scheduled once it is.";
  }
  if (row.nextConsultation !== null) {
    return "The consultation is already scheduled. Move it from the matter's Calendar.";
  }
  return undefined;
}

/** The title a consultation is scheduled under, from what the desk already knows. */
export function consultationTitle(row: Pick<IntakeDeskRow, "clientDisplayName" | "title">): string {
  const client = row.clientDisplayName?.trim() ?? "";
  return client === "" ? `Consultation: ${row.title}` : `Consultation with ${client}`;
}

/**
 * What the Consultation cell reads: the setting's date and wall-clock time in its own zone, or the
 * honest absence. The time is left out, not filled with midnight, when none was recorded.
 */
export function consultationText(setting: IntakeDeskConsultation | null): string {
  if (setting === null) return "Not scheduled";
  return setting.startsAtTime === null
    ? setting.startsOn
    : `${setting.startsOn} ${setting.startsAtTime}`;
}

/** The lookups the column model resolves handles against, read once per screen. */
export interface IntakeDeskVocabulary {
  matterTypeNames: readonly string[];
  memberNames: readonly string[];
}

export const EMPTY_INTAKE_DESK_VOCABULARY: IntakeDeskVocabulary = {
  matterTypeNames: [],
  memberNames: [],
};

/**
 * The desk's columns. The consultation number anchors the row, as the matter number anchors the
 * docket: it is what a receptionist quotes back to a caller. Practice area and the responsible
 * member take the SET filter over the firm's declared vocabularies, so a type nobody has used yet
 * is still offered; Client is a set over what the desk happens to hold, because nothing publishes
 * a client directory.
 */
export function intakeDeskColumns(vocabulary: IntakeDeskVocabulary): GridColumn<IntakeDeskRow>[] {
  return [
    {
      id: "consultationNumber",
      label: "Number",
      anchored: true,
      value: (row) => row.consultationNumber ?? UNNUMBERED_INTAKE,
    },
    {
      id: "status",
      label: "Status",
      filter: "set",
      value: (row) => matterStatusLabel(row.status),
      filterValues: INTAKE_DESK_STATUS_LABELS,
    },
    {
      id: "client",
      label: "Client",
      filter: "set",
      value: (row) => row.clientDisplayName,
    },
    { id: "title", label: "Title", value: (row) => row.title },
    {
      id: "matterType",
      label: "Practice Area",
      filter: "set",
      value: (row) => row.matterTypeName,
      filterValues: vocabulary.matterTypeNames,
    },
    {
      id: "responsible",
      label: "Responsible Attorney",
      filter: "set",
      value: (row) => row.responsibleMemberName,
      filterValues: vocabulary.memberNames,
    },
    {
      id: "standing",
      label: "Intake",
      // Sorted by what is left to do, so the intakes nearest to completing rise together and the
      // completed consultations sit ahead of them.
      type: "number",
      align: "start",
      value: (row) => (row.status === "consultation" ? -1 : row.checklist.outstandingRequired),
      text: (row) => intakeStandingText(row.checklist, row.status),
    },
    {
      id: "consultation",
      label: "Consultation",
      type: "date",
      value: (row) => row.nextConsultation?.startsOn ?? null,
      text: (row) => consultationText(row.nextConsultation),
    },
    {
      id: "createdAt",
      label: "Started",
      type: "date",
      value: (row) => row.createdAt,
    },
  ];
}

/** Newest first: the intake the phone just produced is the one the desk is looking for. */
export const INTAKE_DESK_INITIAL_SORT = { columnId: "createdAt", direction: "descending" } as const;
