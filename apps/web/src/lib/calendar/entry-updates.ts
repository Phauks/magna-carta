/*
 * What a correction sends. The record forms send everything; the entry window's Edit sends the
 * fields its pane edits and nothing else, so the participants on a setting are never re-sent by a
 * window that did not touch them, and a deadline's source stays frozen on the record.
 *
 * Each projection takes the full create request the draft already builds and keeps only the keys
 * the update contract carries. Held here as pure functions so the invariant — a correction never
 * re-sends participants — is asserted without a browser.
 */
import type {
  CreateDeadlineRequest,
  CreateEventRequest,
  CreateFirmEventRequest,
  UpdateDeadlineRequest,
  UpdateEventRequest,
  UpdateFirmEventRequest,
} from "./calendar-api.ts";

export function eventUpdateOf(request: CreateEventRequest): UpdateEventRequest {
  return {
    eventTypeId: request.eventTypeId,
    title: request.title,
    description: request.description,
    startsOn: request.startsOn,
    startsAtTime: request.startsAtTime,
    endsOn: request.endsOn,
    endsAtTime: request.endsAtTime,
    timeZone: request.timeZone,
    locationText: request.locationText,
    conferenceUrl: request.conferenceUrl,
    courtReference: request.courtReference,
  };
}

export function deadlineUpdateOf(request: CreateDeadlineRequest): UpdateDeadlineRequest {
  return {
    title: request.title,
    dueOn: request.dueOn,
    dueAtTime: request.dueAtTime,
    timeZone: request.timeZone,
    authorityText: request.authorityText,
    triggerEventId: request.triggerEventId,
    priority: request.priority,
  };
}

export function firmEventUpdateOf(request: CreateFirmEventRequest): UpdateFirmEventRequest {
  return {
    eventTypeId: request.eventTypeId,
    title: request.title,
    description: request.description,
    startsOn: request.startsOn,
    startsAtTime: request.startsAtTime,
    endsOn: request.endsOn,
    endsAtTime: request.endsAtTime,
    timeZone: request.timeZone,
    locationId: request.locationId,
    locationText: request.locationText,
    conferenceUrl: request.conferenceUrl,
  };
}
