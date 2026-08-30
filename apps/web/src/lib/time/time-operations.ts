/*
 * What a person can actually do to a time entry, and what the server will actually accept.
 *
 * The design gives the ledger a fuller verb set than this: unsubmit, delete-draft, move to another
 * ledger, refile onto another matter, attach a file, write a memo. None of those has a route, so
 * none of them is called from here — they are rendered where the design puts them, disabled, saying
 * what they wait on. What IS here is exactly the set the contract serves, so the difference between
 * "designed" and "working" is a difference a reader of this file can see.
 *
 * Every call goes through the one transport seam, so a dead network is an outcome rather than a
 * thrown error, and the surface can say something true about it.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type { TimeEntrySummary } from "$lib/matters/time-api.ts";

/** What the create route answers: the identity of the entry it wrote. */
export interface TimeEntryAcknowledgement {
  timeEntryId: string;
}

/** The facts a new draft is written from. Everything else about it is the server's to decide. */
export interface DraftTimeEntry {
  readonly matterId: string;
  readonly timekeeperUserId: string;
  readonly workDate: string;
  readonly rawDurationMinutes: number;
  readonly narrative: string;
  readonly billable: boolean;
}

/**
 * Record a draft. The contract requires an idempotency key on the write, because a retried save
 * must not put a second entry on the matter's ledger.
 */
export function createTimeEntry(
  fetchImpl: typeof fetch,
  draft: DraftTimeEntry,
  idempotencyKey: string,
): Promise<ApiOutcome<TimeEntryAcknowledgement>> {
  return requestJson(fetchImpl, "/api/v1/time-entries", {
    method: "POST",
    body: { ...draft, source: "manual" },
    idempotencyKey,
  });
}

/** The parts of an entry the update route accepts. Nothing else on the record is settable yet. */
export interface TimeEntryChanges {
  readonly narrative?: string;
  readonly rawDurationMinutes?: number;
  readonly workDate?: string;
}

export function patchTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  changes: TimeEntryChanges,
): Promise<ApiOutcome<TimeEntrySummary>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${timeEntryId}`, {
    method: "PATCH",
    body: changes,
  });
}

export function submitTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
): Promise<ApiOutcome<unknown>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${timeEntryId}/submit`, { method: "POST" });
}

export function approveTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
): Promise<ApiOutcome<unknown>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${timeEntryId}/approve`, { method: "POST" });
}

/**
 * Return an entry to its timekeeper as a draft.
 *
 * The design settled that the reason is optional and recorded only when given; the route requires
 * one, so the surface asks for it and this call cannot pretend otherwise. The difference is
 * recorded rather than papered over with a stand-in sentence nobody wrote.
 */
export function kickBackTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
  reason: string,
): Promise<ApiOutcome<unknown>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${timeEntryId}/kick-back`, {
    method: "POST",
    body: { reason },
  });
}

/** Strike an entry. It stays on the ledger, carries no value, and is not removed. */
export function voidTimeEntry(
  fetchImpl: typeof fetch,
  timeEntryId: string,
): Promise<ApiOutcome<unknown>> {
  return requestJson(fetchImpl, `/api/v1/time-entries/${timeEntryId}/void`, { method: "POST" });
}

/** A fresh idempotency key for one write attempt and its retries. */
export function writeKey(): string {
  return crypto.randomUUID();
}

/**
 * Reading a duration somebody typed. Both literacies are accepted, because both are shown: "1:30"
 * and "1.5" are the same ninety minutes, and "90m" is too.
 */
export function parseDurationText(text: string): number | null {
  const trimmed = text.trim();
  const clock = /^(\d+):([0-5]\d)$/.exec(trimmed);
  if (clock !== null) return Number(clock[1]) * 60 + Number(clock[2]);
  const decimal = /^(\d+(?:\.\d+)?)\s*h?$/i.exec(trimmed);
  if (decimal !== null) return Math.round(Number(decimal[1]) * 60);
  const minutes = /^(\d+)\s*m$/i.exec(trimmed);
  if (minutes !== null) return Number(minutes[1]);
  return null;
}

/**
 * Why a save cannot go through yet, in the words the reader needs, or null when it can.
 *
 * The rule is the design's: an advance control validates before it enables, so nothing is pressed
 * only to come back with a failure the client could have named.
 */
export function draftRefusal(input: {
  readonly durationText: string;
  readonly description: string;
}): string | null {
  const minutes = parseDurationText(input.durationText);
  if (minutes === null || minutes <= 0) return "Enter the time worked";
  if (input.description.trim() === "") return "Enter the Description: every entry states its work";
  return null;
}
