import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type {
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { listMeetingMessages } from "../src/chat-statements.ts";
import { postGuestMeetingMessage } from "../src/chat-service.ts";
import {
  arriveAsGuest,
  GUEST_ARRIVAL_GUARD,
  GUEST_RETURN_GUARD,
  guestCredentialRefusal,
  GuestNoLongerOnTheEventError,
  hashGuestSecret,
  inviteGuest,
  leaveAsGuest,
  listMeetingGuests,
  normalizeGuestName,
  readGuestMeeting,
  revokeGuestLink,
  rotateGuestLink,
  whyTheSpendWasRefused,
} from "../src/guest-service.ts";
import { readGuestInvitation, readGuestStay } from "../src/guest-statements.ts";
import {
  guestGrantExpiresAt,
  guestLinkExpiresAt,
  GUEST_LINK_GRACE_HOURS,
  MAX_GUEST_ARRIVALS,
} from "../src/guest-types.ts";
import { removeParticipant, setMeetingLocked } from "../src/hosting-service.ts";
import { admitParticipants, denyParticipants } from "../src/lobby-service.ts";
import { countWaitingAttendance, listWaitingAttendance } from "../src/lobby-statements.ts";
import { MAX_MEETING_LOBBY } from "../src/lobby-types.ts";
import {
  closeAttendanceAfterSocketLoss,
  createMeeting,
  endMeeting,
  joinMeeting,
} from "../src/meeting-service.ts";
import {
  countOpenAttendance,
  listAttendance,
  MEETING_STAY_TABLES,
  readMeetingSummary,
} from "../src/meeting-statements.ts";
import { MAX_MEETING_PARTICIPANTS } from "../src/types.ts";
import { MeetingValidationError } from "../src/validation.ts";
import {
  CROWD,
  END_INSTANT,
  HOST,
  MATTER_EVENT,
  commit,
  endClock,
  migratedDatabase,
  options,
  optionsFor,
  seedFirm,
  tickingClock,
  visibility,
} from "./support.ts";

// SOMEBODY FROM OUTSIDE THE FIRM, over node:sqlite.
//
// The questions every test here is really asking: does a guest count exactly where a member counts —
// in the room against the room's ceiling, at the door against the door's — and nowhere a member would
// not; does every read of "who was present" see both tables; and does a host's decision about a guest
// stick, because a removal undone by reopening an e-mail would be a button that does nothing.

const CLIENT = "directoryPerson_meetingGuestClient000" as const;
const COMPANY = "directoryOrganization_meetingGuestCompany00" as const;
const STRANGER = "directoryPerson_meetingGuestStranger0" as const;
const NO_ADDRESS = "directoryPerson_meetingGuestNoMail000" as const;

const EVENT_ENDS_AT = "2026-09-21T17:30:00.000Z";
const eventEndsAt = () => EVENT_ENDS_AT;

// Decisions stamped after every arrival a test can stage, for the reason the lobby suite gives: a
// stay's span is a CHECK, and a departure stamped before its arrival is refused for the wrong reason.
const DECIDED_AT = "2026-09-18T13:00:00.000Z";
const deciding = { ...options, clock: { now: () => DECIDED_AT } };

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  const created = "2026-08-01T00:00:00.000Z";
  database.raw.exec(
    `INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES ` +
      `('${CLIENT}', 'Jane Hollis', '${created}', '${created}'), ` +
      `('${STRANGER}', 'Somebody Else', '${created}', '${created}'), ` +
      `('${NO_ADDRESS}', 'No Address', '${created}', '${created}')`,
  );
  database.raw.exec(
    `INSERT INTO directory_organization (id, display_name, created_at, updated_at) VALUES ` +
      `('${COMPANY}', 'Acme Corporation', '${created}', '${created}')`,
  );
  database.raw.exec(
    `INSERT INTO directory_email (id, entity_id, address, is_primary, created_at, updated_at) VALUES ` +
      `('directoryEmail_meetingGuestClient000', '${CLIENT}', 'jane@example.test', 1, '${created}', '${created}'), ` +
      `('directoryEmail_meetingGuestCompany00', '${COMPANY}', 'office@example.test', 1, '${created}', '${created}'), ` +
      `('directoryEmail_meetingGuestStranger0', '${STRANGER}', 'else@example.test', 1, '${created}', '${created}')`,
  );
  // On the event: the client and the company as Directory entities, a person with no usable address,
  // and a court reporter known only by a typed name — the one kind of participant that has nothing a
  // link could be minted for. The stranger is in the Directory and not on the event.
  database.raw.exec(
    `INSERT INTO matter_event_participant (id, event_id, participant_kind, entity_id, participant_name, created_at, updated_at) VALUES ` +
      `('matterEventParticipant_meetingGuest01', '${MATTER_EVENT}', 'entity', '${CLIENT}', NULL, '${created}', '${created}'), ` +
      `('matterEventParticipant_meetingGuest02', '${MATTER_EVENT}', 'entity', '${COMPANY}', NULL, '${created}', '${created}'), ` +
      `('matterEventParticipant_meetingGuest03', '${MATTER_EVENT}', 'entity', '${NO_ADDRESS}', NULL, '${created}', '${created}'), ` +
      `('matterEventParticipant_meetingGuest04', '${MATTER_EVENT}', 'external', NULL, 'Court Reporter', '${created}', '${created}')`,
  );
  return database;
}

type Database = ReturnType<typeof fresh>;

async function start(database: Database, lobby: "off" | "on" = "off"): Promise<MeetingId> {
  const { meetingId, effect } = await createMeeting(
    database.database,
    { eventKind: "matter", eventId: MATTER_EVENT, lobby },
    options,
  );
  await commit(database.database, effect);
  return meetingId;
}

async function invite(
  database: Database,
  meetingId: MeetingId,
  entityId: string = CLIENT,
): Promise<{ invitationId: MeetingGuestInvitationId; secret: string; secretVersion: number }> {
  const minted = await inviteGuest(
    database.database,
    meetingId,
    { entityId, eventEndsAt },
    options,
  );
  await commit(database.database, minted.effect);
  return {
    invitationId: minted.invitation.id,
    secret: minted.secret,
    secretVersion: minted.secretVersion,
  };
}

async function arrive(
  database: Database,
  meetingId: MeetingId,
  invitation: { invitationId: MeetingGuestInvitationId; secretVersion: number },
  name = "Jane Hollis",
): Promise<MeetingGuestStayId> {
  const arrived = await arriveAsGuest(
    database.database,
    { meetingId, invitationId: invitation.invitationId, secretVersion: invitation.secretVersion },
    { confirmedName: name },
    { clock: tickingClock() },
  );
  await commit(database.database, arrived.effect);
  return arrived.stayId;
}

async function join(database: Database, meetingId: MeetingId, userId: UserId) {
  const joined = await joinMeeting(
    database.database,
    meetingId,
    optionsFor(userId, tickingClock()),
  );
  await commit(database.database, joined.effect);
  return joined;
}

async function refusalOf(pending: Promise<unknown>): Promise<string> {
  const caught = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(MeetingValidationError);
  return (caught as MeetingValidationError).code;
}

async function auditEvents(database: Database, meetingId: MeetingId): Promise<string[]> {
  const { results } = await database.database
    .prepare("SELECT event FROM audit_log WHERE subject_id = ?1 ORDER BY created_at, id")
    .bind(meetingId)
    .all<{ event: string }>();
  return results.map((row) => row.event);
}

describe("minting a link", () => {
  it("is for a Directory entity on the event, and nothing else", async () => {
    const database = fresh();
    const meetingId = await start(database);

    // Not on the event at all.
    expect(
      await refusalOf(
        inviteGuest(database.database, meetingId, { entityId: STRANGER, eventEndsAt }, options),
      ),
    ).toBe("guest-not-invitable");
    // A participant of kind `external` carries only a typed name: there is no entity to name, and a
    // member's handle is not an entity either.
    expect(
      await refusalOf(
        inviteGuest(
          database.database,
          meetingId,
          { entityId: "Court Reporter", eventEndsAt },
          options,
        ),
      ),
    ).toBe("guest-not-invitable");
    expect(
      await refusalOf(
        inviteGuest(database.database, meetingId, { entityId: HOST, eventEndsAt }, options),
      ),
    ).toBe("guest-not-invitable");
    // On the event, but with no address the firm may use.
    expect(
      await refusalOf(
        inviteGuest(database.database, meetingId, { entityId: NO_ADDRESS, eventEndsAt }, options),
      ),
    ).toBe("guest-not-invitable");
  });

  it("stores the secret's hash and never the secret, and reports where the mail goes", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const minted = await inviteGuest(
      database.database,
      meetingId,
      { entityId: CLIENT, eventEndsAt },
      options,
    );
    expect(minted.emailAddress).toBe("jane@example.test");
    expect(minted.invitation.invitedName).toBe("Jane Hollis");
    await commit(database.database, minted.effect);

    const row = await readGuestInvitation(database.database, minted.invitation.id);
    expect(row?.token_secret_hash).toBe(await hashGuestSecret(minted.secret));
    expect(row?.directory_email_id).toBe("directoryEmail_meetingGuestClient000");
    // Neither the secret nor the address is anywhere on the row or in the audit log.
    const everything = JSON.stringify(
      await database.database.prepare("SELECT * FROM audit_log").all(),
    );
    expect(JSON.stringify(row)).not.toContain(minted.secret);
    expect(everything).not.toContain(minted.secret);
    expect(everything).not.toContain("jane@example.test");
  });

  it("a second mint against the same entity rotates the one invitation rather than adding one", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const first = await invite(database, meetingId);
    const second = await invite(database, meetingId);

    expect(second.invitationId).toBe(first.invitationId);
    expect(second.secretVersion).toBe(2);
    const { results } = await database.database
      .prepare("SELECT COUNT(*) AS count FROM meeting_guest_invitation WHERE meeting_id = ?1")
      .bind(meetingId)
      .all<{ count: number }>();
    expect(results[0]?.count).toBe(1);
    const row = await readGuestInvitation(database.database, first.invitationId);
    expect(row?.token_secret_hash).toBe(await hashGuestSecret(second.secret));
    // The first link's version no longer verifies.
    expect(
      guestCredentialRefusal({
        invitation: row,
        meetingStatus: "scheduled",
        secretVersion: first.secretVersion,
        secretMatches: null,
        now: "2026-09-18T12:00:00.000Z",
      }),
    ).toBe("guest-link-not-valid");
  });

  it("is a host act on this meeting", async () => {
    const database = fresh();
    const meetingId = await start(database);
    expect(
      await refusalOf(
        inviteGuest(
          database.database,
          meetingId,
          { entityId: CLIENT, eventEndsAt },
          optionsFor(CROWD[0] as UserId),
        ),
      ),
    ).toBe("meeting-not-host");
  });
});

describe("the link's life", () => {
  it("ends two hours after the event and never more than a fortnight after the mint", () => {
    expect(guestLinkExpiresAt("2026-09-18T12:00:00.000Z", "2026-09-18T15:00:00.000Z")).toBe(
      "2026-09-18T17:00:00.000Z",
    );
    expect(guestLinkExpiresAt("2026-09-18T12:00:00.000Z", "2026-12-01T15:00:00.000Z")).toBe(
      "2026-10-02T12:00:00.000Z",
    );
    // An event already over when the link is sent still leaves the grace, from the mint.
    expect(guestLinkExpiresAt("2026-09-18T12:00:00.000Z", "2026-09-17T09:00:00.000Z")).toBe(
      new Date(
        Date.parse("2026-09-18T12:00:00.000Z") + GUEST_LINK_GRACE_HOURS * 3_600_000,
      ).toISOString(),
    );
    // A grant never outlives the link it was spent from.
    expect(guestGrantExpiresAt("2026-09-18T12:00:00.000Z", "2026-09-18T13:00:00.000Z")).toBe(
      "2026-09-18T13:00:00.000Z",
    );
  });

  it("is refused once withdrawn, once expired, and once its meeting has ended", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    const row = await readGuestInvitation(database.database, link.invitationId);
    const base = {
      invitation: row,
      meetingStatus: "live" as const,
      secretVersion: link.secretVersion,
      secretMatches: true,
      now: "2026-09-18T12:00:00.000Z",
    };
    expect(guestCredentialRefusal(base)).toBeNull();
    expect(guestCredentialRefusal({ ...base, secretMatches: false })).toBe("guest-link-not-valid");
    expect(guestCredentialRefusal({ ...base, now: "2026-10-30T00:00:00.000Z" })).toBe(
      "guest-link-expired",
    );
    expect(guestCredentialRefusal({ ...base, meetingStatus: "ended" })).toBe(
      "meeting-already-ended",
    );
    expect(guestCredentialRefusal({ ...base, invitation: undefined })).toBe("guest-link-not-valid");

    const revoked = await revokeGuestLink(
      database.database,
      meetingId,
      link.invitationId,
      deciding,
    );
    await commit(database.database, revoked.effect);
    expect(
      guestCredentialRefusal({
        ...base,
        invitation: await readGuestInvitation(database.database, link.invitationId),
      }),
    ).toBe("guest-link-revoked");
  });
});

describe("arriving", () => {
  it("opens a stay AT THE DOOR whatever the lobby setting, and counts the spend", async () => {
    const database = fresh();
    // The lobby is OFF, and the guest still waits: the door is what a link opens onto.
    const meetingId = await start(database, "off");
    const link = await invite(database, meetingId);
    const stayId = await arrive(database, meetingId, link);

    const stay = await readGuestStay(database.database, stayId);
    expect(stay?.waiting_from).not.toBeNull();
    expect(stay?.admitted_at).toBeNull();
    expect(stay?.left_at).toBeNull();
    expect(stay?.confirmed_name).toBe("Jane Hollis");
    expect((await readGuestInvitation(database.database, link.invitationId))?.arrival_count).toBe(
      1,
    );
    // At the door is not in the room: the live count does not move and the meeting is not live.
    const summary = await readMeetingSummary(database.database, meetingId, visibility);
    expect(summary?.liveCount).toBe(0);
    expect(summary?.status).toBe("scheduled");
    expect(await auditEvents(database, meetingId)).toContain("meetings.guest.arrived");
  });

  it("a second arrival while the stay is waiting returns that stay under the name just typed, in its place", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    const first = await arrive(database, meetingId, link, "Jane Hollis");
    const waitingFrom = (await readGuestStay(database.database, first))?.waiting_from;
    const second = await arrive(database, meetingId, link, "Somebody Different");
    expect(second).toBe(first);
    const stay = await readGuestStay(database.database, first);
    // The host reads the name typed THIS time: whoever holds the link now is who is at the door.
    expect(stay?.confirmed_name).toBe("Somebody Different");
    // A waiter who comes back keeps their place in the queue.
    expect(stay?.waiting_from).toBe(waitingFrom);
    expect(stay?.admitted_at).toBeNull();
    expect((await readGuestInvitation(database.database, link.invitationId))?.arrival_count).toBe(
      2,
    );
  });

  it("a second arrival on an ADMITTED stay puts it back at the door under the new name, and keeps the old one on the record", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const link = await invite(database, meetingId);
    const stayId = await arrive(database, meetingId, link, "Jane Hollis");
    const admission = await admitParticipants(database.database, meetingId, [stayId], deciding);
    await commit(database.database, admission.effect);
    expect((await readMeetingSummary(database.database, meetingId, visibility))?.liveCount).toBe(2);

    // Somebody the link was forwarded to presses Join.
    const again = await arriveAsGuest(
      database.database,
      { meetingId, invitationId: link.invitationId, secretVersion: link.secretVersion },
      { confirmedName: "A Stranger" },
      { clock: { now: () => "2026-09-18T14:00:00.000Z" } },
    );
    expect(again).toMatchObject({
      stayId,
      returnedToOpenStay: true,
      returnedFromTheRoom: true,
      confirmedName: "A Stranger",
    });
    await commit(database.database, again.effect);

    const stay = await readGuestStay(database.database, stayId);
    expect(stay).toMatchObject({
      confirmed_name: "A Stranger",
      admitted_at: null,
      admitted_by_user_id: null,
      waiting_from: "2026-09-18T14:00:00.000Z",
      left_at: null,
    });
    // Out of the room — the stranger does not inherit the seat — and at the door, under the new name.
    expect((await readMeetingSummary(database.database, meetingId, visibility))?.liveCount).toBe(1);
    const door = await listWaitingAttendance(database.database, meetingId, 101);
    expect(door).toEqual([
      expect.objectContaining({
        participantId: stayId,
        displayName: "A Stranger",
        invitedName: "Jane Hollis",
      }),
    ]);
    // The name the host admitted survives on the arrival's audit row.
    const { results } = await database.database
      .prepare(
        "SELECT metadata FROM audit_log WHERE subject_id = ?1 AND event = 'meetings.guest.arrived' " +
          "ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .bind(meetingId)
      .all<{ metadata: string }>();
    expect(JSON.parse(results[0]?.metadata ?? "{}")).toMatchObject({
      stayId,
      returnedToOpenStay: true,
      returnedFromTheRoom: true,
      previousConfirmedName: "Jane Hollis",
      previouslyAdmittedByUserId: HOST,
    });
  });

  it("an arrival that would take an admitted stay back to a full door is refused, and changes nothing", async () => {
    const database = fresh();
    const meetingId = await start(database, "on");
    await join(database, meetingId, HOST);
    const link = await invite(database, meetingId);
    const stayId = await arrive(database, meetingId, link);
    const admission = await admitParticipants(database.database, meetingId, [stayId], deciding);
    await commit(database.database, admission.effect);
    for (const userId of CROWD.slice(0, MAX_MEETING_LOBBY)) await join(database, meetingId, userId);

    expect(await refusalOf(arrive(database, meetingId, link, "Somebody Else"))).toBe(
      "meeting-lobby-full",
    );
    expect((await readGuestStay(database.database, stayId))?.admitted_at).not.toBeNull();
  });

  it("an arrival racing a host's removal of the open stay rolls back whole", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const link = await invite(database, meetingId);
    const stayId = await arrive(database, meetingId, link);
    const composed = await arriveAsGuest(
      database.database,
      { meetingId, invitationId: link.invitationId, secretVersion: link.secretVersion },
      { confirmedName: "Jane Hollis" },
      { clock: tickingClock() },
    );
    const removal = await removeParticipant(database.database, meetingId, stayId, {
      ...deciding,
      clock: { now: () => "2026-09-18T13:30:00.000Z" },
    });
    await commit(database.database, removal.effect);
    const racing = await commit(database.database, composed.effect).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    expect((racing as GuardedWriteRefusedError).guard).toBe(GUEST_RETURN_GUARD);
    expect((await readGuestInvitation(database.database, link.invitationId))?.arrival_count).toBe(
      1,
    );
  });

  it("is refused, and recorded, once the entity is no longer on the event", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    database.raw.exec(
      `DELETE FROM matter_event_participant WHERE id = 'matterEventParticipant_meetingGuest01'`,
    );

    const caught = await arriveAsGuest(
      database.database,
      { meetingId, invitationId: link.invitationId, secretVersion: link.secretVersion },
      { confirmedName: "Jane Hollis" },
      { clock: tickingClock() },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(GuestNoLongerOnTheEventError);
    expect((caught as GuestNoLongerOnTheEventError).code).toBe("guest-link-revoked");
    await commit(database.database, (caught as GuestNoLongerOnTheEventError).effect);
    expect(await auditEvents(database, meetingId)).toContain("meetings.guest.arrivalRefused");
    expect((await readGuestInvitation(database.database, link.invitationId))?.arrival_count).toBe(
      0,
    );
    // Opening the link is refused too — and writes nothing, because opening it is a read.
    expect(
      await refusalOf(
        readGuestMeeting(database.database, {
          meetingId,
          invitationId: link.invitationId,
          secretVersion: link.secretVersion,
        }),
      ),
    ).toBe("guest-link-revoked");
  });

  it("a refused spend is answered with what the row now says, not one sentence for every cause", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    const credential = {
      meetingId,
      invitationId: link.invitationId,
      secretVersion: link.secretVersion,
    };
    const now = "2026-09-18T12:30:00.000Z";
    database.raw.exec(
      `UPDATE meeting_guest_invitation SET arrival_count = ${String(MAX_GUEST_ARRIVALS)} WHERE id = '${link.invitationId}'`,
    );
    expect(await whyTheSpendWasRefused(database.database, credential, now)).toBe(
      "guest-link-exhausted",
    );
    expect(
      await whyTheSpendWasRefused(database.database, credential, "2026-12-01T00:00:00.000Z"),
    ).toBe("guest-link-expired");
    await invite(database, meetingId);
    expect(await whyTheSpendWasRefused(database.database, credential, now)).toBe(
      "guest-link-not-valid",
    );
    const revoked = await revokeGuestLink(
      database.database,
      meetingId,
      link.invitationId,
      deciding,
    );
    await commit(database.database, revoked.effect);
    expect(await whyTheSpendWasRefused(database.database, credential, now)).toBe(
      "guest-link-revoked",
    );
  });

  it("refuses the arrival past the link's ceiling", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    database.raw.exec(
      `UPDATE meeting_guest_invitation SET arrival_count = ${String(MAX_GUEST_ARRIVALS)} WHERE id = '${link.invitationId}'`,
    );
    expect(
      await refusalOf(
        arriveAsGuest(
          database.database,
          { meetingId, invitationId: link.invitationId, secretVersion: link.secretVersion },
          { confirmedName: "Jane Hollis" },
          { clock: tickingClock() },
        ),
      ),
    ).toBe("guest-link-exhausted");
  });

  it("a link withdrawn under an arrival rolls the whole arrival back", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    const composed = await arriveAsGuest(
      database.database,
      { meetingId, invitationId: link.invitationId, secretVersion: link.secretVersion },
      { confirmedName: "Jane Hollis" },
      { clock: tickingClock() },
    );
    const revoked = await revokeGuestLink(
      database.database,
      meetingId,
      link.invitationId,
      deciding,
    );
    await commit(database.database, revoked.effect);
    const racing = await commit(database.database, composed.effect).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    expect((racing as GuardedWriteRefusedError).guard).toBe(GUEST_ARRIVAL_GUARD);
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(0);
  });

  it("a locked room refuses the arrival and the link is not spent", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const link = await invite(database, meetingId);
    const locked = await setMeetingLocked(database.database, meetingId, true, deciding);
    await commit(database.database, locked.effect);
    expect(
      await refusalOf(
        arriveAsGuest(
          database.database,
          { meetingId, invitationId: link.invitationId, secretVersion: link.secretVersion },
          { confirmedName: "Jane Hollis" },
          { clock: tickingClock() },
        ),
      ),
    ).toBe("meeting-locked");
    expect((await readGuestInvitation(database.database, link.invitationId))?.arrival_count).toBe(
      0,
    );
  });

  it("a stay closed removed or denied refuses the next arrival on that link", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);

    const denied = await invite(database, meetingId, CLIENT);
    const deniedStay = await arrive(database, meetingId, denied);
    const denial = await denyParticipants(database.database, meetingId, [deniedStay], deciding);
    expect(denial.decisions).toEqual([{ participantId: deniedStay, outcome: "denied" }]);
    await commit(database.database, denial.effect);
    expect(await refusalOf(arrive(database, meetingId, denied))).toBe("meeting-not-admitted");

    const removed = await invite(database, meetingId, COMPANY);
    const removedStay = await arrive(database, meetingId, removed, "A Stand-In");
    const admission = await admitParticipants(
      database.database,
      meetingId,
      [removedStay],
      deciding,
    );
    await commit(database.database, admission.effect);
    const removal = await removeParticipant(database.database, meetingId, removedStay, {
      ...deciding,
      clock: { now: () => "2026-09-18T13:30:00.000Z" },
    });
    expect(removal.userId).toBeNull();
    await commit(database.database, removal.effect);
    expect((await readGuestStay(database.database, removedStay))?.ended_reason).toBe("removed");
    expect(await refusalOf(arrive(database, meetingId, removed))).toBe("meeting-removed");

    const events = await auditEvents(database, meetingId);
    expect(events).toEqual(
      expect.arrayContaining([
        "meetings.guest.denied",
        "meetings.guest.admitted",
        "meetings.meeting.removed",
        "meetings.guest.left",
      ]),
    );
  });

  it("the name at the door is normalized, bounded, and never empty", () => {
    expect(normalizeGuestName("  Jane \n\t Hollis  ")).toBe("Jane Hollis");
    // A right-to-left override is a format character, and it does not survive.
    expect(normalizeGuestName("Jane‮Hollis")).toBe("Jane Hollis");
    expect(() => normalizeGuestName("   ")).toThrow(MeetingValidationError);
    expect(() => normalizeGuestName("x".repeat(81))).toThrow(MeetingValidationError);
    expect(normalizeGuestName("x".repeat(80))).toHaveLength(80);
  });
});

describe("one ceiling over both kinds of stay", () => {
  it("MAX_MEETING_PARTICIPANTS counts admitted members and admitted guests together", async () => {
    const database = fresh();
    const meetingId = await start(database, "off");
    await join(database, meetingId, HOST);
    // The room, one seat short of full, of members walking straight in.
    for (const userId of CROWD.slice(0, MAX_MEETING_PARTICIPANTS - 2)) {
      await join(database, meetingId, userId);
    }
    expect(await countOpenAttendance(database.database, meetingId)).toBe(
      MAX_MEETING_PARTICIPANTS - 1,
    );

    const first = await arrive(database, meetingId, await invite(database, meetingId, CLIENT));
    const second = await arrive(
      database,
      meetingId,
      await invite(database, meetingId, COMPANY),
      "Company Delegate",
    );
    const admission = await admitParticipants(
      database.database,
      meetingId,
      [first, second],
      deciding,
    );
    // One seat, two guests: the first in the order the host sent them gets it, and the host learns
    // which one did not.
    expect(admission.decisions).toEqual([
      { participantId: first, outcome: "admitted" },
      { participantId: second, outcome: "room-full" },
    ]);
    await commit(database.database, admission.effect);
    expect(await countOpenAttendance(database.database, meetingId)).toBe(MAX_MEETING_PARTICIPANTS);
    // The guest who did not get in is still at the door rather than dropped.
    expect((await readGuestStay(database.database, second))?.left_at).toBeNull();
  });

  it("the guarded admission refuses the guest past the ceiling when a member takes the last seat first", async () => {
    const database = fresh();
    const meetingId = await start(database, "off");
    await join(database, meetingId, HOST);
    for (const userId of CROWD.slice(0, MAX_MEETING_PARTICIPANTS - 2)) {
      await join(database, meetingId, userId);
    }
    const guest = await arrive(database, meetingId, await invite(database, meetingId));
    const composed = await admitParticipants(database.database, meetingId, [guest], deciding);
    expect(composed.decisions[0]?.outcome).toBe("admitted");
    // A member walks into the last seat between the host's read and the commit.
    await join(database, meetingId, CROWD[MAX_MEETING_PARTICIPANTS - 1] as UserId);
    const racing = await commit(database.database, composed.effect).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(racing).toBeInstanceOf(GuardedWriteRefusedError);
    expect((await readGuestStay(database.database, guest))?.admitted_at).toBeNull();
  });

  it("MAX_MEETING_LOBBY counts waiting members and waiting guests together", async () => {
    const database = fresh();
    const meetingId = await start(database, "on");
    await join(database, meetingId, HOST);
    for (const userId of CROWD.slice(0, MAX_MEETING_LOBBY - 1)) {
      const joined = await join(database, meetingId, userId);
      expect(joined.waiting).toBe(true);
    }
    await arrive(database, meetingId, await invite(database, meetingId, CLIENT));
    expect(await countWaitingAttendance(database.database, meetingId)).toBe(MAX_MEETING_LOBBY);

    // The door is full for a member because of a guest, and for a guest because of the members.
    expect(
      await refusalOf(
        joinMeeting(database.database, meetingId, optionsFor(CROWD[200] as UserId, tickingClock())),
      ),
    ).toBe("meeting-lobby-full");
    expect(
      await refusalOf(
        arrive(database, meetingId, await invite(database, meetingId, COMPANY), "Delegate"),
      ),
    ).toBe("meeting-lobby-full");
  });
});

describe("every read of who was present sees both tables", () => {
  it("names every stay table the schema declares", async () => {
    const database = fresh();
    // A STAY TABLE is any table with the stay's own instants. A third kind of stay added to the
    // schema without joining MEETING_STAY_TABLES — and with it, every count built from that list —
    // fails here rather than under-reporting the record quietly.
    const { results } = await database.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();
    const stayTables: string[] = [];
    for (const { name } of results) {
      const columns = await database.database
        .prepare(`SELECT name FROM pragma_table_info(?1)`)
        .bind(name)
        .all<{ name: string }>();
      const names = new Set(columns.results.map((column) => column.name));
      if (
        ["meeting_id", "joined_at", "waiting_from", "admitted_at", "left_at"].every((c) =>
          names.has(c),
        )
      ) {
        stayTables.push(name);
      }
    }
    expect(stayTables.toSorted()).toEqual(
      MEETING_STAY_TABLES.map((entry) => entry.table).toSorted(),
    );
  });

  it("a meeting holding one member and one guest reads two entries and a live count of two", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const guest = await arrive(database, meetingId, await invite(database, meetingId));
    const admission = await admitParticipants(database.database, meetingId, [guest], deciding);
    await commit(database.database, admission.effect);

    const attendance = await listAttendance(database.database, meetingId, { limit: 10 });
    expect(attendance.map((row) => row.participant_kind).toSorted()).toEqual(["guest", "member"]);
    const guestEntry = attendance.find((row) => row.participant_kind === "guest");
    expect(guestEntry?.user_id).toBeNull();
    expect(guestEntry?.display_name).toBe("Jane Hollis");
    expect(guestEntry?.entity_id).toBe(CLIENT);
    expect(guestEntry?.invited_name).toBe("Jane Hollis");
    expect((await readMeetingSummary(database.database, meetingId, visibility))?.liveCount).toBe(2);
  });

  it("the attendance read returns both kinds in joined_at order across a page boundary", async () => {
    const database = fresh();
    const meetingId = await start(database, "off");
    const at = (minute: number) => ({
      now: () => `2026-09-18T12:${String(minute).padStart(2, "0")}:00.000Z`,
    });
    const hostJoin = await joinMeeting(database.database, meetingId, optionsFor(HOST, at(1)));
    await commit(database.database, hostJoin.effect);
    const clientLink = await invite(database, meetingId, CLIENT);
    const clientArrival = await arriveAsGuest(
      database.database,
      { meetingId, invitationId: clientLink.invitationId, secretVersion: 1 },
      { confirmedName: "Jane Hollis" },
      { clock: at(2) },
    );
    await commit(database.database, clientArrival.effect);
    const memberJoin = await joinMeeting(
      database.database,
      meetingId,
      optionsFor(CROWD[0] as UserId, at(3)),
    );
    await commit(database.database, memberJoin.effect);
    const companyLink = await invite(database, meetingId, COMPANY);
    const companyArrival = await arriveAsGuest(
      database.database,
      { meetingId, invitationId: companyLink.invitationId, secretVersion: 1 },
      { confirmedName: "Delegate" },
      { clock: at(4) },
    );
    await commit(database.database, companyArrival.effect);

    const first = await listAttendance(database.database, meetingId, { limit: 2 });
    // One row past the page is the answer to "is there more".
    expect(first).toHaveLength(3);
    const page = first.slice(0, 2);
    expect(page.map((row) => row.participant_kind)).toEqual(["member", "guest"]);
    const last = page.at(-1);
    const rest = await listAttendance(database.database, meetingId, {
      limit: 2,
      cursor: { createdAt: last?.joined_at ?? "", id: last?.id ?? "" },
    });
    expect(rest.map((row) => row.participant_kind)).toEqual(["member", "guest"]);
    expect(rest.map((row) => row.id)).toEqual([memberJoin.attendanceId, companyArrival.stayId]);
  });

  it("the lobby list carries a guest's kind and both names", async () => {
    const database = fresh();
    const meetingId = await start(database, "on");
    await join(database, meetingId, HOST);
    await join(database, meetingId, CROWD[0] as UserId);
    await arrive(database, meetingId, await invite(database, meetingId, COMPANY), "Jane Hollis");
    const door = await listWaitingAttendance(database.database, meetingId, 101);
    const guest = door.find((entry) => entry.kind === "guest");
    expect(guest?.userId).toBeNull();
    expect(guest?.displayName).toBe("Jane Hollis");
    expect(guest?.invitedName).toBe("Acme Corporation");
    expect(door.find((entry) => entry.kind === "member")?.invitedName).toBeNull();
  });
});

describe("ending a meeting", () => {
  it("closes every stay of both kinds, waiting and admitted, at ONE instant", async () => {
    const database = fresh();
    const meetingId = await start(database, "on");
    await join(database, meetingId, HOST);
    const waitingMember = await join(database, meetingId, CROWD[0] as UserId);
    expect(waitingMember.waiting).toBe(true);
    const waitingGuest = await arrive(
      database,
      meetingId,
      await invite(database, meetingId, CLIENT),
    );
    const admittedGuest = await arrive(
      database,
      meetingId,
      await invite(database, meetingId, COMPANY),
      "Delegate",
    );
    const admission = await admitParticipants(
      database.database,
      meetingId,
      [admittedGuest],
      deciding,
    );
    await commit(database.database, admission.effect);

    const ended = await endMeeting(database.database, meetingId, { ...options, clock: endClock });
    await commit(database.database, ended.effect);

    const attendance = await listAttendance(database.database, meetingId, { limit: 50 });
    expect(attendance.length).toBe(4);
    expect(new Set(attendance.map((row) => row.left_at))).toEqual(new Set([END_INSTANT]));
    expect((await readGuestStay(database.database, waitingGuest))?.left_at).toBe(END_INSTANT);
  });
});

describe("withdrawing and rotating", () => {
  it("withdrawing puts a guest in the room out, and keeps the row", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const link = await invite(database, meetingId);
    const stay = await arrive(database, meetingId, link);
    const admission = await admitParticipants(database.database, meetingId, [stay], deciding);
    await commit(database.database, admission.effect);

    const revoked = await revokeGuestLink(database.database, meetingId, link.invitationId, {
      ...deciding,
      clock: { now: () => "2026-09-18T13:30:00.000Z" },
    });
    expect(revoked.closedStayId).toBe(stay);
    await commit(database.database, revoked.effect);
    // Closed `left`, which bars nothing: a withdrawal is a decision about the link, not the person.
    expect((await readGuestStay(database.database, stay))?.ended_reason).toBe("left");
    expect(await auditEvents(database, meetingId)).not.toContain("meetings.meeting.removed");
    expect(
      (await readGuestInvitation(database.database, link.invitationId))?.revoked_at,
    ).not.toBeNull();
    const listed = await listMeetingGuests(database.database, meetingId, options);
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]?.revokedAt).not.toBeNull();
    expect(listed.next).toBeNull();

    // A second withdrawal moves nothing.
    const again = await revokeGuestLink(database.database, meetingId, link.invitationId, deciding);
    expect(again.effect.statements).toHaveLength(0);
    // And a withdrawn link is not rotated: minting again is how a host reinstates one.
    expect(
      await refusalOf(
        rotateGuestLink(database.database, meetingId, link.invitationId, { eventEndsAt }, deciding),
      ),
    ).toBe("guest-link-revoked");
  });

  it("rotating moves the version, sends a fresh mail, and closes the stay the old link held", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const link = await invite(database, meetingId);
    const stay = await arrive(database, meetingId, link);
    const admission = await admitParticipants(database.database, meetingId, [stay], deciding);
    await commit(database.database, admission.effect);
    const rotated = await rotateGuestLink(
      database.database,
      meetingId,
      link.invitationId,
      {
        eventEndsAt,
      },
      { ...deciding, clock: { now: () => "2026-09-18T13:30:00.000Z" } },
    );
    expect(rotated.secretVersion).toBe(2);
    expect(rotated.emailAddress).toBe("jane@example.test");
    expect(rotated.closedStayId).toBe(stay);
    await commit(database.database, rotated.effect);

    // Closed in the same batch as the rotation, `left` — nobody is barred — and out of the room.
    expect((await readGuestStay(database.database, stay))?.ended_reason).toBe("left");
    expect((await readMeetingSummary(database.database, meetingId, visibility))?.liveCount).toBe(1);
    const events = await auditEvents(database, meetingId);
    expect(events).toContain("meetings.guest.linkRotated");
    expect(events).toContain("meetings.guest.left");
    // A fresh link is a fresh budget.
    expect((await readGuestInvitation(database.database, link.invitationId))?.arrival_count).toBe(
      0,
    );

    // The person the fresh mail reached arrives on it, into a new stay, at the door.
    const renewed = await arrive(database, meetingId, { ...link, secretVersion: 2 });
    expect(renewed).not.toBe(stay);
    expect((await readGuestStay(database.database, renewed))?.admitted_at).toBeNull();
  });

  it("an exhausted link comes back to life when a host sends a fresh one", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    database.raw.exec(
      `UPDATE meeting_guest_invitation SET arrival_count = ${String(MAX_GUEST_ARRIVALS)} WHERE id = '${link.invitationId}'`,
    );
    expect(await refusalOf(arrive(database, meetingId, link))).toBe("guest-link-exhausted");

    const rotated = await rotateGuestLink(
      database.database,
      meetingId,
      link.invitationId,
      { eventEndsAt },
      deciding,
    );
    expect(rotated.invitation.arrivalCount).toBe(0);
    await commit(database.database, rotated.effect);
    await arrive(database, meetingId, { ...link, secretVersion: 2 });

    // And inviting the entity again does the same.
    database.raw.exec(
      `UPDATE meeting_guest_invitation SET arrival_count = ${String(MAX_GUEST_ARRIVALS)} WHERE id = '${link.invitationId}'`,
    );
    // Stamped after the arrival above, whose stay this reissue closes.
    const again = await inviteGuest(
      database.database,
      meetingId,
      { entityId: CLIENT, eventEndsAt },
      { ...options, clock: { now: () => "2026-09-18T15:00:00.000Z" } },
    );
    await commit(database.database, again.effect);
    expect((await readGuestInvitation(database.database, link.invitationId))?.arrival_count).toBe(
      0,
    );
    await arrive(
      database,
      meetingId,
      { invitationId: again.invitation.id, secretVersion: again.secretVersion },
      "Jane Hollis",
    );
  });

  it("withdrawing a waiting guest's link and inviting them again lets them arrive", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId);
    const waiting = await arrive(database, meetingId, link);
    const revoked = await revokeGuestLink(
      database.database,
      meetingId,
      link.invitationId,
      deciding,
    );
    expect(revoked.closedStayId).toBe(waiting);
    await commit(database.database, revoked.effect);

    const reinstated = await invite(database, meetingId);
    expect(reinstated.invitationId).toBe(link.invitationId);
    const stay = await arrive(database, meetingId, reinstated);
    expect(stay).not.toBe(waiting);
    expect((await readGuestStay(database.database, stay))?.left_at).toBeNull();
  });
});

describe("what a guest does in the room", () => {
  it("reads the reduced summary and nothing of the matter", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const link = await invite(database, meetingId, COMPANY);
    const summary = await readGuestMeeting(database.database, {
      meetingId,
      invitationId: link.invitationId,
      secretVersion: 1,
    });
    expect(summary).toEqual({
      title: "Settlement conference",
      startsOn: "2026-09-21",
      startsAtTime: "09:30",
      endsAtTime: "10:30",
      timeZone: "America/Los_Angeles",
      medium: "video",
      status: "scheduled",
      invitedName: "Acme Corporation",
    });
    expect(Object.keys(summary)).not.toContain("matterId");
    expect(Object.keys(summary)).not.toContain("eventId");
  });

  it("speaks only from inside the room, on the record, with nobody in the member column", async () => {
    const database = fresh();
    const meetingId = await start(database);
    await join(database, meetingId, HOST);
    const link = await invite(database, meetingId);
    const stay = await arrive(database, meetingId, link);
    const credential = { meetingId, invitationId: link.invitationId, stayId: stay };

    expect(
      await refusalOf(
        postGuestMeetingMessage(
          database.database,
          credential,
          { body: "hello" },
          { clock: tickingClock() },
        ),
      ),
    ).toBe("meeting-not-joined");

    const admission = await admitParticipants(database.database, meetingId, [stay], deciding);
    await commit(database.database, admission.effect);
    const posted = await postGuestMeetingMessage(
      database.database,
      credential,
      { body: "Good afternoon." },
      { clock: { now: () => "2026-09-18T13:10:00.000Z" } },
    );
    await commit(database.database, posted.effect);
    const transcript = await listMeetingMessages(database.database, meetingId, { limit: 10 });
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.participantKind).toBe("guest");
    expect(transcript[0]?.participantId).toBe(stay);
    expect(transcript[0]?.userId).toBeNull();
  });

  it("leaves, and a connection that never came back is closed by the sweep", async () => {
    const database = fresh();
    const meetingId = await start(database);
    const first = await arrive(database, meetingId, await invite(database, meetingId, CLIENT));
    const left = await leaveAsGuest(
      database.database,
      {
        meetingId,
        invitationId: (await readGuestStay(database.database, first))
          ?.invitation_id as MeetingGuestInvitationId,
        secretVersion: 1,
        stayId: first,
      },
      { clock: { now: () => DECIDED_AT } },
    );
    await commit(database.database, left.effect);
    expect((await readGuestStay(database.database, first))?.ended_reason).toBe("left");

    const second = await arrive(
      database,
      meetingId,
      await invite(database, meetingId, COMPANY),
      "Delegate",
    );
    const swept = await closeAttendanceAfterSocketLoss(database.database, second, {
      clock: { now: () => DECIDED_AT },
    });
    expect(swept.closed).toBe(true);
    await commit(database.database, swept.effect);
    expect((await readGuestStay(database.database, second))?.ended_reason).toBe("socket-lost");
  });
});
