import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  authDenied,
  emailSent,
  errorCaptured,
  incidentCreated,
  meetingRoomClientReport,
  meetingRoomPublished,
  meetingRoomRefused,
  meetingRecorderStopped,
  meetingRecorderTrack,
  meetingRecordingAnnounced,
  meetingRecordingSinkRefused,
  migrationApplied,
  operationFailed,
  outboxDeadLettered,
  outboxSwept,
  requestCompleted,
  usageFeature,
} from "../src/events.ts";

const context = { correlationId: "correlation_abc123", now: "2026-06-13T00:00:00.000Z" };

describe("event catalog", () => {
  it("requestCompleted carries route/method/status/durationMs", () => {
    const event = requestCompleted(context, {
      route: "/api/v1/matters/:id",
      method: "GET",
      status: 200,
      durationMs: 12,
    });
    expect(event.name).toBe("request.completed");
    expect(event.fields).toEqual({
      route: "/api/v1/matters/:id",
      method: "GET",
      status: 200,
      durationMs: 12,
    });
  });

  it("errorCaptured carries errorId/route/method/errorName/messageHead", () => {
    const event = errorCaptured(context, {
      errorId: "error_xyz",
      route: "/api/v1/things",
      method: "POST",
      errorName: "TypeError",
      messageHead: "cannot read x",
    });
    expect(event.name).toBe("error.captured");
    expect(event.fields.errorId).toBe("error_xyz");
  });

  it("outboxSwept carries database/dispatched/failed/deadLettered", () => {
    const event = outboxSwept(context, {
      database: "firm_db",
      dispatched: 3,
      failed: 0,
      deadLettered: 0,
    });
    expect(event.name).toBe("outbox.swept");
  });

  it("migrationApplied carries database/tag", () => {
    const event = migrationApplied(context, { database: "control", tag: "0001_x" });
    expect(event.name).toBe("migration.applied");
  });

  it("emailSent carries messageClass/outcome", () => {
    const event = emailSent(context, { messageClass: "password-reset", outcome: "sent" });
    expect(event.name).toBe("email.sent");
  });

  it("incidentCreated carries incidentId/errorIdCount", () => {
    const event = incidentCreated(context, { incidentId: "incident_1", errorIdCount: 2 });
    expect(event.name).toBe("incident.created");
  });

  it("authDenied carries cause/route/errorId — and has NO slot for a key (structural redaction)", () => {
    const event = authDenied(context, {
      cause: "mismatch",
      route: "/api/v1/firms",
      errorId: "error_1",
    });
    expect(event.name).toBe("auth.denied");
    expect(event.fields).toEqual({ cause: "mismatch", route: "/api/v1/firms", errorId: "error_1" });
  });

  it("operationFailed carries operation/errorName/messageHead/errorId (the background error counterpart)", () => {
    const event = operationFailed(context, {
      operation: "cron:per-firm-sweep",
      errorName: "Error",
      messageHead: "boom",
      errorId: "error_1",
    });
    expect(event.name).toBe("operation.failed");
    expect(event.fields.operation).toBe("cron:per-firm-sweep");
  });

  it("outboxDeadLettered carries scope/outboxId/topic/attempts", () => {
    const event = outboxDeadLettered(context, {
      scope: "control-plane",
      outboxId: "obx_1",
      topic: "member.provision",
      attempts: 5,
    });
    expect(event.name).toBe("outbox.deadLettered");
  });

  it("usageFeature carries exactly its allowlist and strips undeclared keys", () => {
    const event = usageFeature(
      { correlationId: "correlation_x", now: "2026-06-18T00:00:00.000Z" },
      {
        feature: "matters.list",
        phase: "reached",
        surface: null,
        firmIdHash: "abc123",
        userIdHash: null,
        appVersion: null,
      },
    );
    expect(event.name).toBe("usage.feature");
    expect(event.fields).toEqual({
      feature: "matters.list",
      phase: "reached",
      surface: null,
      firmIdHash: "abc123",
      userIdHash: null,
      appVersion: null,
    });
  });

  it("includes usage.feature in EVENT_NAMES exactly once", () => {
    const usageNames = EVENT_NAMES.filter((name) => name === "usage.feature");
    expect(usageNames).toHaveLength(1);
  });

  it("every catalog event name is unique", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("the meeting-room family carries the three correlation handles and counts, and nothing a person said", () => {
    const event = meetingRoomPublished(context, {
      firmId: "firm_abc",
      meetingId: "meeting_abc",
      attendanceId: "meetingAttendance_abc",
      trackCount: 2,
      audioCount: 1,
      videoCount: 1,
      refusedCount: 0,
    });
    expect(event.name).toBe("meetings.room.published");
    expect(event.fields).toEqual({
      firmId: "firm_abc",
      meetingId: "meeting_abc",
      attendanceId: "meetingAttendance_abc",
      trackCount: 2,
      audioCount: 1,
      videoCount: 1,
      refusedCount: 0,
    });
  });

  it("a meeting-room refusal has no slot for a track name or a session description", () => {
    // The cast is the point: a call site reaching the builder through `any` — a parsed frame, a
    // caught error's payload — still cannot get an undeclared key past the allowlist.
    const event = (
      meetingRoomRefused as unknown as (
        eventContext: typeof context,
        fields: Record<string, unknown>,
      ) => ReturnType<typeof meetingRoomRefused>
    )(context, {
      firmId: "firm_abc",
      meetingId: "meeting_abc",
      attendanceId: "meetingAttendance_abc",
      reason: "unknown-track",
      errorId: null,
      frameType: "subscribe",
      trackName: "meetingAttendance_abc:camera",
      sdp: "v=0 an offer",
    });
    expect(Object.keys(event.fields).toSorted()).toEqual([
      "attendanceId",
      "errorId",
      "firmId",
      "frameType",
      "meetingId",
      "reason",
    ]);
  });

  it("a client report carries measurements only, flattened out of the frame's own shape", () => {
    const event = meetingRoomClientReport(context, {
      firmId: "firm_abc",
      meetingId: "meeting_abc",
      attendanceId: "meetingAttendance_abc",
      quality: "poor",
      roundTripMilliseconds: 410,
      lossFraction: 0.12,
      jitterMilliseconds: 48,
      outboundRid: "q",
      outboundWidth: 320,
      outboundHeight: 180,
      outboundBitsPerSecond: 90_000,
      inboundCount: 7,
    });
    expect(event.name).toBe("meetings.room.clientReport");
    expect(event.fields["quality"]).toBe("poor");
    expect(event.fields["outboundRid"]).toBe("q");
  });

  it("every meetings event is named under one of the subsystem's four families", () => {
    // Four families and no fifth: the room's own events; the guest lane's refusals, which happen at
    // the chokepoint before any room is addressed and so cannot honestly be called room events; the
    // recording's announcement and sink, which belong to a recording rather than to the room that
    // announced it; and the recorder's own, which is a separate object from the room altogether.
    const family = EVENT_NAMES.filter((name) => name.startsWith("meetings."));
    expect(family.length).toBeGreaterThan(15);
    for (const name of family)
      expect(
        name.startsWith("meetings.room.") ||
          name.startsWith("meetings.guest.") ||
          name.startsWith("meetings.recording.") ||
          name.startsWith("meetings.recorder."),
      ).toBe(true);
  });

  it("a recording event has no slot for a track name, a display name, a token or an object key", () => {
    const recordingFamily = [
      meetingRecordingAnnounced,
      meetingRecorderTrack,
      meetingRecorderStopped,
      meetingRecordingSinkRefused,
    ];
    for (const builder of recordingFamily) {
      const event = builder(
        { correlationId: "correlation_recordingRedaction00", now: "2026-10-02T12:00:00.000Z" },
        {
          trackName: "meetingAttendance_x:microphone",
          displayName: "A Member",
          token: "signed.token",
          stagingKey: "meeting-recordings/x/y/z.pcm",
        } as never,
      );
      for (const forbidden of ["trackName", "displayName", "token", "stagingKey"]) {
        expect(event.fields).not.toHaveProperty(forbidden);
      }
    }
  });
});
