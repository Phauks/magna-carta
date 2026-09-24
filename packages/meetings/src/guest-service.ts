import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SortCursor } from "@magna-carta/data-access/cursor-pagination";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { cryptoRandomSource, type RandomSource } from "@magna-carta/identifiers/random";
import type {
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
} from "@magna-carta/identifiers/types";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import {
  closeGuestStayStatement,
  insertGuestInvitationStatement,
  insertGuestStayAtTheDoorStatement,
  isEntityOnMeetingEvent,
  listGuestInvitationRows,
  readBarredGuestStay,
  readDirectoryEntityName,
  readGuestEmail,
  readGuestInvitationForEntity,
  readGuestInvitationInMeeting,
  readGuestStay,
  readMeetingForGuest,
  readOpenGuestStay,
  recordGuestArrivalStatement,
  reissueGuestInvitationStatement,
  revokeGuestInvitationStatement,
} from "./guest-statements.ts";
import {
  guestLinkExpiresAt,
  MAX_GUEST_ARRIVALS,
  MAX_GUEST_CONFIRMED_NAME_LENGTH,
  type GuestEventFacts,
  type GuestMeetingSummary,
  type MeetingGuestEntityKind,
  type MeetingGuestInvitationEntry,
  type MeetingGuestInvitationRow,
} from "./guest-types.ts";
import { removalOfGuestStatements } from "./guest-removal.ts";
import { requireHostGrant, type MeetingHostingOptions } from "./hosting-service.ts";
import { countWaitingAttendance } from "./lobby-statements.ts";
import { MAX_MEETING_LOBBY } from "./lobby-types.ts";
import { readMeeting } from "./meeting-statements.ts";
import type { MeetingDepartureReason, MeetingRow, MeetingStatus } from "./types.ts";
import { refuse, type MeetingValidationCode } from "./validation.ts";

// SOMEBODY FROM OUTSIDE THE FIRM: the host's three acts on a link (mint, rotate, withdraw), and the
// guest's three on a stay (look, arrive, leave).
//
// Nothing here reads a clock, holds a binding, or calls anything external — the clock, the actor and
// the random source arrive as options, as they do everywhere in this package. The e-mail is the
// Worker's to send, AFTER the batch that minted the link commits: this returns the address and the
// secret for that one send and stores neither.
//
// THE HOST'S ACTS RIDE `meetings:host` AND A GRANT ON THIS MEETING, exactly as every other host act
// does: somebody who may run this meeting is somebody who may decide who is in it, and the event's own
// visibility predicate has already answered the harder question of whether they may see the matter.
//
// THE GUEST'S ACTS NAME NO USER AT ALL. A guest holds no session and never will; their audit rows carry
// a null actor, because the actor column is a member and a guest is not one. What the rows carry
// instead is the invitation and the stay — identifiers and instants, never the token, the secret, the
// address, or anything anybody said.

/** The label a second mint's reissue carries: another mint of the same link landed first. */
export const REISSUE_GUEST_LINK_GUARD = "meeting.guest.reissue";

/** The label a withdrawal carries. */
export const REVOKE_GUEST_LINK_GUARD = "meeting.guest.revoke";

/** The label the link's spend carries: withdrawn, rotated, used up or expired under the arrival. */
export const GUEST_ARRIVAL_GUARD = "meeting.guest.arrival";

/** The label the door carries: the lobby filled, or the room was locked or ended, under the arrival. */
export const GUEST_DOOR_GUARD = "meeting.guest.door";

/** The label a guest's own leave carries. */
export const GUEST_LEAVE_GUARD = "meeting.guest.leave";

// The departure labels a guest's stay closes with, named once so the column, the audit metadata and
// the barred-entry read cannot drift on a string.
const DEPARTED = "left" satisfies MeetingDepartureReason;
const SOCKET_LOST = "socket-lost" satisfies MeetingDepartureReason;
const REMOVED = "removed" satisfies MeetingDepartureReason;

// 256 bits of CSPRNG entropy: the bearer secret a link carries. Minted through the platform's one
// random source, like every other credential here.
const GUEST_SECRET_BYTES = 32;

/** What the credential the chokepoint verified says about the guest presenting it. */
export interface GuestCredentialFacts {
  readonly meetingId: MeetingId;
  readonly invitationId: MeetingGuestInvitationId;
  readonly secretVersion: number;
}

/** What a guest's own acts need beyond the credential: the clock and the random source. */
export interface GuestActOptions {
  readonly clock: { now(): string };
  readonly randomSource?: RandomSource;
}

/** What a mint or a rotation hands the Worker for its one send, and never stores. */
export interface MintedGuestLink {
  readonly invitation: MeetingGuestInvitationEntry;
  /** The bearer secret, for the token. Never written anywhere; the row holds its hash. */
  readonly secret: string;
  readonly secretVersion: number;
  /** Where the one mail goes. Read from the Directory for this send, and never written anywhere. */
  readonly emailAddress: string;
  /** The event the mail describes. */
  readonly event: GuestEventFacts;
  /** A guest stay the old link still holds open, whose sockets the room should close. */
  readonly openStayId: MeetingGuestStayId | null;
  readonly effect: EffectWrite;
}

// ---------------------------------------------------------------------------------------------
// The host's acts on a link
// ---------------------------------------------------------------------------------------------

/**
 * A link minted for a Directory entity on this meeting's event, and the one e-mail's worth of facts.
 *
 * ONE LIVE LINK PER ENTITY PER MEETING, so a second mint against the same pair REISSUES the existing
 * invitation — a fresh secret, the version moved on, a withdrawal undone — rather than creating a
 * second: two live links for one guest would be two withdrawals to perform and one to forget.
 *
 * `eventEndsAt` is the caller's, because it needs the event's own zone and this package has none.
 */
export async function inviteGuest(
  database: SqlDatabase,
  meetingId: MeetingId,
  input: {
    readonly entityId: string;
    readonly directoryEmailId?: string;
    readonly eventEndsAt: (event: GuestEventFacts) => string;
  },
  options: MeetingHostingOptions,
): Promise<MintedGuestLink & { readonly reissued: boolean }> {
  const meeting = await readHostedMeeting(database, meetingId, options);
  const facts = await readMeetingForGuest(database, meetingId);
  if (facts === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");

  const entityKind = entityKindOf(input.entityId);
  if (entityKind === null || !(await isEntityOnMeetingEvent(database, meeting, input.entityId))) {
    // THE ONE REFUSAL for every shape that is not a Directory entity on this event: a member, an
    // external participant known only by a typed name, a handle that is not on the event at all. An
    // external participant is invited by promoting them to the Directory first, which is a deliberate
    // act with a known cost — never a side effect of sending a link.
    refuse(
      "guest-not-invitable",
      "only a person or organization from the Directory who is on this event can be invited",
    );
  }
  const invitedName = await readDirectoryEntityName(database, entityKind, input.entityId);
  if (invitedName === undefined) {
    refuse("guest-not-invitable", "that Directory entry cannot be invited");
  }
  const email = await readGuestEmail(database, input.entityId, input.directoryEmailId);
  if (email === undefined) {
    refuse(
      "guest-not-invitable",
      "that person has no e-mail address in the Directory the firm may use",
    );
  }

  const now = options.clock.now();
  const expiresAt = guestLinkExpiresAt(now, input.eventEndsAt(facts.event));
  const { secret, hash } = await mintGuestSecret(options.randomSource);
  const existing = await readGuestInvitationForEntity(database, meetingId, input.entityId);

  if (existing !== undefined) {
    const openStay = await readOpenGuestStay(database, meetingId, existing.id);
    return {
      reissued: true,
      ...reissue(database, meetingId, existing, {
        secret,
        hash,
        invitedName,
        directoryEmailId: email.id,
        emailAddress: email.address,
        expiresAt,
        event: facts.event,
        openStayId: openStay?.id ?? null,
        reinstated: existing.revoked_at !== null,
        now,
        options,
      }),
    };
  }

  const invitationId = newIdentifier("meetingGuestInvitation", options.randomSource);
  return {
    reissued: false,
    secret,
    secretVersion: 1,
    emailAddress: email.address,
    event: facts.event,
    openStayId: null,
    invitation: {
      id: invitationId,
      entityKind,
      entityId: input.entityId,
      invitedName,
      expiresAt,
      revokedAt: null,
      arrivalCount: 0,
      lastArrivalAt: null,
    },
    effect: {
      statements: [
        insertGuestInvitationStatement(database, {
          id: invitationId,
          meetingId,
          entityKind,
          entityId: input.entityId,
          invitedName,
          directoryEmailId: email.id,
          tokenSecretHash: hash,
          issuedByUserId: options.actorUserId,
          expiresAt,
          now,
        }),
        domainAuditStatement(database, {
          event: "meetings.guest.invited",
          subjectId: meetingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers and instants. Never the secret, never the token, never the address — which
          // contact point is named by its row, and the address stays the Directory's fact.
          metadata: {
            invitationId,
            entityKind,
            entityId: input.entityId,
            directoryEmailId: email.id,
            secretVersion: 1,
            expiresAt,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * A fresh secret on an existing link, and a fresh mail — the answer to "the client forwarded it to
 * the whole company by accident".
 *
 * Every token of the old version stops verifying at once, and every grant minted from it fails at its
 * next request. A withdrawn link is not rotated: minting again is how a host reinstates one, and a
 * rotation that quietly reinstated a link somebody withdrew would undo a decision nobody re-made.
 */
export async function rotateGuestLink(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
  input: { readonly eventEndsAt: (event: GuestEventFacts) => string },
  options: MeetingHostingOptions,
): Promise<MintedGuestLink> {
  await readHostedMeeting(database, meetingId, options);
  const facts = await readMeetingForGuest(database, meetingId);
  if (facts === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  const invitation = await readInvitationOnMeeting(database, meetingId, invitationId);
  if (invitation.revoked_at !== null) {
    refuse("guest-link-revoked", "that link was withdrawn; send a new one instead");
  }

  // The same contact point the link went to before, where it still stands; otherwise whatever the
  // Directory would choose today. A rotation is a fresh mail, and a mail needs an address the person
  // has not asked the firm to stop using.
  const email =
    (await readGuestEmail(
      database,
      invitation.entity_id,
      invitation.directory_email_id ?? undefined,
    )) ?? (await readGuestEmail(database, invitation.entity_id, undefined));
  if (email === undefined) {
    refuse(
      "guest-not-invitable",
      "that person has no e-mail address in the Directory the firm may use",
    );
  }

  const now = options.clock.now();
  const { secret, hash } = await mintGuestSecret(options.randomSource);
  const openStay = await readOpenGuestStay(database, meetingId, invitation.id);
  return reissue(database, meetingId, invitation, {
    secret,
    hash,
    // The name the link was minted for stays what it was: a rotation is the same invitation with a
    // new secret, and the record's "invited as" must not quietly change under a stay already on it.
    invitedName: invitation.invited_name,
    directoryEmailId: email.id,
    emailAddress: email.address,
    expiresAt: guestLinkExpiresAt(now, input.eventEndsAt(facts.event)),
    event: facts.event,
    openStayId: openStay?.id ?? null,
    reinstated: false,
    now,
    options,
  });
}

/**
 * A link withdrawn — and a guest in the room on it put out.
 *
 * THE ROW IS KEPT: who was invited is part of what the record says happened, and deleting it would
 * make an invitation that was withdrawn indistinguishable from one never sent. A guest holding an
 * open stay on the link is closed `removed` in the SAME batch, with the removal's own two audit rows,
 * so the withdrawal and the removal commit together; the route tells the room afterwards, on the
 * standing ordering — nobody is told they are out by a write that then failed.
 *
 * A link already withdrawn produces no statements: the host asked for it not to work, and it does not.
 */
export async function revokeGuestLink(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
  options: MeetingHostingOptions,
): Promise<{
  readonly invitation: MeetingGuestInvitationEntry;
  readonly removedStayId: MeetingGuestStayId | null;
  readonly effect: EffectWrite;
}> {
  await readHostedMeeting(database, meetingId, options);
  const invitation = await readInvitationOnMeeting(database, meetingId, invitationId);
  if (invitation.revoked_at !== null) {
    return {
      invitation: entryOf(invitation),
      removedStayId: null,
      effect: { statements: [], outboxMessages: [] },
    };
  }

  const now = options.clock.now();
  const openStay = await readOpenGuestStay(database, meetingId, invitation.id);
  const statements: EffectStatement[] = [
    guarded(
      revokeGuestInvitationStatement(database, {
        id: invitation.id,
        revokedByUserId: options.actorUserId,
        now,
      }),
      REVOKE_GUEST_LINK_GUARD,
    ),
    domainAuditStatement(database, {
      event: "meetings.guest.linkRevoked",
      subjectId: meetingId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { invitationId: invitation.id, entityId: invitation.entity_id, revokedAt: now },
    }),
  ];
  if (openStay !== undefined) {
    statements.push(
      ...removalOfGuestStatements(database, meetingId, openStay.id, invitation.id, now, {
        ...options,
        reason: REMOVED,
        joinedAt: openStay.joined_at,
        guard: REVOKE_GUEST_LINK_GUARD,
      }),
    );
  }
  return {
    invitation: { ...entryOf(invitation), revokedAt: now },
    removedStayId: openStay?.id ?? null,
    effect: { statements, outboxMessages: [] },
  };
}

/** The most invitations one page of a host's Guests panel carries. */
export const MAX_GUEST_INVITATION_PAGE_SIZE = 50;

/**
 * The invitations on one meeting, as a host's Guests panel paints them — one page, oldest first, with
 * the row the next page continues from. A host act, like the rest: who has been sent a way into a
 * meeting is not something everybody who may join it needs to read.
 */
export async function listMeetingGuests(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingHostingOptions,
  page: { readonly cursor?: SortCursor; readonly limit?: number } = {},
): Promise<{
  readonly entries: readonly MeetingGuestInvitationEntry[];
  readonly next: { readonly createdAt: string; readonly id: string } | null;
}> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  await requireHostGrant(database, meetingId, options.actorUserId);
  const limit = page.limit ?? MAX_GUEST_INVITATION_PAGE_SIZE;
  const rows = await listGuestInvitationRows(database, meetingId, {
    ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    limit,
  });
  const shown = rows.slice(0, limit);
  const last = shown.at(-1);
  return {
    entries: shown.map(entryOf),
    next:
      rows.length > limit && last !== undefined
        ? { createdAt: last.created_at, id: last.id }
        : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The guest's own acts, addressed by a verified credential
// ---------------------------------------------------------------------------------------------

/**
 * Why a SIGNED credential cannot be used right now, or null when it can.
 *
 * The chokepoint's guest lane asks this of the live row on every request, after the signature has
 * verified — so each answer here is a sentence said to somebody the firm sent a link to, and each is
 * specific. The order is the order a person can act on: a withdrawn link is withdrawn whatever else is
 * true of it, a replaced one is replaced, then time, then the meeting.
 *
 * `secretMatches` is the Worker's constant-time comparison of the presented secret's hash with the
 * row's — null for a grant, which carries no secret and was minted only after one matched.
 */
export function guestCredentialRefusal(input: {
  readonly invitation: MeetingGuestInvitationRow | undefined;
  readonly meetingStatus: MeetingStatus | undefined;
  readonly secretVersion: number;
  readonly secretMatches: boolean | null;
  readonly now: string;
}): MeetingValidationCode | null {
  const invitation = input.invitation;
  if (invitation === undefined || input.meetingStatus === undefined) return "guest-link-not-valid";
  if (invitation.revoked_at !== null) return "guest-link-revoked";
  if (invitation.secret_version !== input.secretVersion) return "guest-link-not-valid";
  if (input.secretMatches === false) return "guest-link-not-valid";
  if (invitation.expires_at <= input.now) return "guest-link-expired";
  if (input.meetingStatus === "ended") return "meeting-already-ended";
  return null;
}

/**
 * The meeting a link opens onto, reduced to what its holder may know — and nothing written.
 *
 * Opening the link spends nothing: a mail client that prefetches it, a scanner that follows every
 * address in a message and a person who clicks twice all cost nothing, because this is a read.
 */
export async function readGuestMeeting(
  database: SqlDatabase,
  credential: GuestCredentialFacts,
): Promise<Omit<GuestMeetingSummary, "firmName">> {
  const facts = await readMeetingForGuest(database, credential.meetingId);
  const invitation = await readGuestInvitationInMeeting(
    database,
    credential.meetingId,
    credential.invitationId,
  );
  if (facts === undefined || invitation === undefined) {
    refuse("guest-link-not-valid", "this link does not open a meeting");
  }
  return {
    title: facts.event.title,
    startsOn: facts.event.startsOn,
    startsAtTime: facts.event.startsAtTime,
    endsAtTime: facts.event.endsAtTime,
    timeZone: facts.event.timeZone,
    medium: facts.medium,
    status: facts.status,
    invitedName: invitation.invited_name,
  };
}

/**
 * Pressing Join: the link is spent, and a stay opens AT THE DOOR.
 *
 * A GUEST ALWAYS WAITS, whatever the meeting's lobby setting says: the link proves a mailbox and
 * nothing more, so it gets a person to the door and a host decides the rest. There is no path here
 * that seats a guest directly.
 *
 * WHAT IS SINGLE-USE IS THE ARRIVAL, NOT THE LINK. A spend while this link already holds an open stay
 * answers with THAT stay rather than opening a second — so a guest whose laptop slept presses Join
 * again and is back where they were, and a second browser on the same link takes the first one's
 * place through the room's one-socket-per-stay rule rather than joining beside it. Every spend is
 * counted against `MAX_GUEST_ARRIVALS`, which is what bounds a link forwarded to a crowd.
 *
 * A LOCKED ROOM IS REFUSED AND THE LINK IS NOT SPENT, on the ruling that lock beats the lobby: a queue
 * in front of a shut door is a queue nobody is admitted from. A guest removed or denied on this link
 * does not come back on it.
 */
export async function arriveAsGuest(
  database: SqlDatabase,
  credential: GuestCredentialFacts,
  input: { readonly confirmedName: string },
  options: GuestActOptions,
): Promise<{
  readonly stayId: MeetingGuestStayId;
  readonly returnedToOpenStay: boolean;
  readonly confirmedName: string;
  readonly linkExpiresAt: string;
  readonly medium: MeetingRow["medium"];
  readonly effect: EffectWrite;
}> {
  const meeting = await readMeetingForGuest(database, credential.meetingId);
  const invitation = await readGuestInvitationInMeeting(
    database,
    credential.meetingId,
    credential.invitationId,
  );
  const now = options.clock.now();
  const refusal = guestCredentialRefusal({
    invitation,
    meetingStatus: meeting?.status,
    secretVersion: credential.secretVersion,
    // The chokepoint compared the secret before this ran; a service called without it must not be
    // able to pass for one that did, which is why the signed version is still compared here.
    secretMatches: null,
    now,
  });
  if (refusal !== null || meeting === undefined || invitation === undefined) {
    refuse(refusal ?? "guest-link-not-valid", "this link cannot be used to join");
  }
  if (invitation.arrival_count >= MAX_GUEST_ARRIVALS) {
    refuse(
      "guest-link-exhausted",
      "this link has been used to join as many times as it can be; ask the firm for a new one",
    );
  }

  const confirmedName = normalizeGuestName(input.confirmedName);
  const spend = guarded(
    recordGuestArrivalStatement(database, {
      id: invitation.id,
      secretVersion: credential.secretVersion,
      maximumArrivals: MAX_GUEST_ARRIVALS,
      now,
    }),
    GUEST_ARRIVAL_GUARD,
  );

  const open = await readOpenGuestStay(database, credential.meetingId, invitation.id);
  if (open !== undefined) {
    return {
      stayId: open.id,
      returnedToOpenStay: true,
      // The name the stay already carries: a reconnect is the same person at the same door, and a
      // second name typed on the way back does not rewrite what the host has been reading.
      confirmedName: open.confirmed_name,
      linkExpiresAt: invitation.expires_at,
      medium: meeting.medium,
      effect: {
        statements: [
          spend,
          arrivalAudit(database, credential.meetingId, invitation.id, open.id, now, true, options),
        ],
        outboxMessages: [],
      },
    };
  }

  // A HOST TURNED THIS LINK AWAY, whether out of the room or at the door. Asked before the lock, for
  // the member path's reason: an unlocked room is still closed to them.
  const barred = await readBarredGuestStay(database, credential.meetingId, invitation.id);
  if (barred?.ended_reason === "denied") {
    refuse("meeting-not-admitted", "a host did not admit you to this meeting");
  }
  if (barred !== undefined) refuse("meeting-removed", "you were removed from this meeting");

  if (meeting.locked_at !== null) refuse("meeting-locked", "this meeting is locked");

  // THE DOOR'S ONE CEILING over members and guests together. This read produces the reason; the
  // insert's own guard produces the limit.
  if ((await countWaitingAttendance(database, credential.meetingId)) >= MAX_MEETING_LOBBY) {
    refuse(
      "meeting-lobby-full",
      `this meeting's lobby is full; it holds ${String(MAX_MEETING_LOBBY)} people`,
    );
  }

  const stayId = newIdentifier("meetingGuestStay", options.randomSource);
  return {
    stayId,
    returnedToOpenStay: false,
    confirmedName,
    linkExpiresAt: invitation.expires_at,
    medium: meeting.medium,
    effect: {
      statements: [
        // The spend FIRST: a link withdrawn or rotated in the round trip since the credential was
        // checked stops the batch before a stay is opened on it.
        spend,
        guarded(
          insertGuestStayAtTheDoorStatement(database, {
            id: stayId,
            meetingId: credential.meetingId,
            invitationId: invitation.id,
            confirmedName,
            lobbyCapacity: MAX_MEETING_LOBBY,
            now,
          }),
          GUEST_DOOR_GUARD,
        ),
        arrivalAudit(database, credential.meetingId, invitation.id, stayId, now, false, options),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * A guest closing their own stay, the way a member's Leave does — the stay named on the grant, and no
 * other. A stay already closed produces nothing: that instant is in somebody's record.
 */
export async function leaveAsGuest(
  database: SqlDatabase,
  credential: GuestCredentialFacts & { readonly stayId: MeetingGuestStayId },
  options: GuestActOptions,
): Promise<{ readonly closed: boolean; readonly effect: EffectWrite }> {
  const stay = await readGuestStay(database, credential.stayId);
  if (
    stay === undefined ||
    stay.meeting_id !== credential.meetingId ||
    stay.invitation_id !== credential.invitationId
  ) {
    refuse("meeting-not-joined", "you are not in this meeting");
  }
  if (stay.left_at !== null) {
    return { closed: false, effect: { statements: [], outboxMessages: [] } };
  }
  const now = options.clock.now();
  return {
    closed: true,
    effect: {
      statements: [
        guarded(
          closeGuestStayStatement(database, { id: stay.id, reason: DEPARTED, now }),
          GUEST_LEAVE_GUARD,
        ),
        guestLeftAudit(database, credential.meetingId, stay, DEPARTED, now, options),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * A guest's stay closed because their connection went and did not come back — the room's sweep, not
 * anybody's act. The member path's twin (`closeAttendanceAfterSocketLoss`), which dispatches here on a
 * guest stay's handle. Refuses nothing; a stay already closed produces nothing.
 */
export async function closeGuestStayAfterSocketLoss(
  database: SqlDatabase,
  stayId: MeetingGuestStayId,
  options: GuestActOptions,
): Promise<{ readonly closed: boolean; readonly effect: EffectWrite }> {
  const stay = await readGuestStay(database, stayId);
  if (stay === undefined || stay.left_at !== null) {
    return { closed: false, effect: { statements: [], outboxMessages: [] } };
  }
  const now = options.clock.now();
  return {
    closed: true,
    effect: {
      statements: [
        guarded(
          closeGuestStayStatement(database, { id: stayId, reason: SOCKET_LOST, now }),
          "meeting.guest.socketLoss",
        ),
        guestLeftAudit(database, stay.meeting_id, stay, SOCKET_LOST, now, options),
      ],
      outboxMessages: [],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

/**
 * A name typed at the door, as the record keeps it: every control and format character removed,
 * every run of white space one space, nothing at either end — and refused when empty or longer than
 * a name at the door may be.
 *
 * It is untrusted display text a host reads before deciding who comes in, so a right-to-left override
 * that makes one name read as another, or padding that pushes the real name off a row, must not
 * survive the trip. Measured in characters, as the row's own CHECK measures it.
 */
export function normalizeGuestName(typed: string): string {
  const normalized = typed
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  // Counted in code points, so a name in a script outside the Basic Multilingual Plane is measured
  // by its characters rather than by its UTF-16 units.
  const length = Array.from(normalized).length;
  if (length === 0 || length > MAX_GUEST_CONFIRMED_NAME_LENGTH) {
    refuse(
      "guest-name-not-valid",
      `give a name of at most ${String(MAX_GUEST_CONFIRMED_NAME_LENGTH)} characters`,
    );
  }
  return normalized;
}

/**
 * 256 bits of CSPRNG entropy as base64url, and the SHA-256 of it the row keeps.
 *
 * The digest is Web Crypto's, which is a global wherever this package runs; it is the one thing here
 * that is not a pure computation, and it touches nothing outside the process.
 */
export async function mintGuestSecret(
  randomSource: RandomSource = cryptoRandomSource,
): Promise<{ readonly secret: string; readonly hash: string }> {
  const bytes = randomSource(GUEST_SECRET_BYTES);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const secret = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { secret, hash: await hashGuestSecret(secret) };
}

/** SHA-256 of a guest secret, lowercase hex — the only form of it the database ever holds. */
export async function hashGuestSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function entityKindOf(entityId: string): MeetingGuestEntityKind | null {
  if (isIdentifier(entityId, "directoryPerson")) return "person";
  if (isIdentifier(entityId, "directoryOrganization")) return "organization";
  return null;
}

function entryOf(row: MeetingGuestInvitationRow): MeetingGuestInvitationEntry {
  return {
    id: row.id,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    invitedName: row.invited_name,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    arrivalCount: row.arrival_count,
    lastArrivalAt: row.last_arrival_at,
  };
}

function reissue(
  database: SqlDatabase,
  meetingId: MeetingId,
  existing: MeetingGuestInvitationRow,
  input: {
    readonly secret: string;
    readonly hash: string;
    readonly invitedName: string;
    readonly directoryEmailId: string;
    readonly emailAddress: string;
    readonly expiresAt: string;
    readonly event: GuestEventFacts;
    readonly openStayId: MeetingGuestStayId | null;
    readonly reinstated: boolean;
    readonly now: string;
    readonly options: MeetingHostingOptions;
  },
): MintedGuestLink {
  const secretVersion = existing.secret_version + 1;
  return {
    secret: input.secret,
    secretVersion,
    emailAddress: input.emailAddress,
    event: input.event,
    openStayId: input.openStayId,
    invitation: {
      ...entryOf(existing),
      invitedName: input.invitedName,
      expiresAt: input.expiresAt,
      revokedAt: null,
    },
    effect: {
      statements: [
        guarded(
          reissueGuestInvitationStatement(database, {
            id: existing.id,
            readVersion: existing.secret_version,
            tokenSecretHash: input.hash,
            invitedName: input.invitedName,
            directoryEmailId: input.directoryEmailId,
            issuedByUserId: input.options.actorUserId,
            expiresAt: input.expiresAt,
            now: input.now,
          }),
          REISSUE_GUEST_LINK_GUARD,
        ),
        domainAuditStatement(database, {
          event: "meetings.guest.linkRotated",
          subjectId: meetingId,
          actorUserId: input.options.actorUserId,
          clock: input.options.clock,
          randomSource: input.options.randomSource,
          metadata: {
            invitationId: existing.id,
            entityId: existing.entity_id,
            directoryEmailId: input.directoryEmailId,
            secretVersion,
            expiresAt: input.expiresAt,
            // A withdrawn link sent again is a reinstatement, and the record says so.
            reinstated: input.reinstated,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

function arrivalAudit(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
  stayId: MeetingGuestStayId,
  now: string,
  returnedToOpenStay: boolean,
  options: GuestActOptions,
) {
  return domainAuditStatement(database, {
    event: "meetings.guest.arrived",
    subjectId: meetingId,
    actorUserId: null,
    clock: options.clock,
    randomSource: options.randomSource,
    // The spend, and whether it opened a stay or came back to one — never the name typed at the door,
    // which is on the stay row where the record keeps it and nowhere else.
    metadata: { invitationId, stayId, waitingFrom: now, returnedToOpenStay },
  });
}

function guestLeftAudit(
  database: SqlDatabase,
  meetingId: MeetingId,
  stay: {
    readonly id: MeetingGuestStayId;
    readonly invitation_id: MeetingGuestInvitationId;
    readonly joined_at: string;
  },
  reason: MeetingDepartureReason,
  now: string,
  options: GuestActOptions,
) {
  return domainAuditStatement(database, {
    event: "meetings.guest.left",
    subjectId: meetingId,
    actorUserId: null,
    clock: options.clock,
    randomSource: options.randomSource,
    metadata: {
      stayId: stay.id,
      invitationId: stay.invitation_id,
      joinedAt: stay.joined_at,
      leftAt: now,
      reason,
    },
  });
}

// The meeting through the gate a host's read goes through, not ended, and the caller running it.
async function readHostedMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: MeetingHostingOptions,
): Promise<MeetingRow> {
  const meeting = await readMeeting(database, meetingId, options.visibility);
  if (meeting === undefined) refuse("meeting-unknown-event", "that is not a meeting you can reach");
  if (meeting.status === "ended") refuse("meeting-already-ended", "this meeting has ended");
  await requireHostGrant(database, meetingId, options.actorUserId);
  return meeting;
}

// An invitation handle from another meeting is as absent as one that names nothing.
async function readInvitationOnMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
): Promise<MeetingGuestInvitationRow> {
  const invitation = await readGuestInvitationInMeeting(database, meetingId, invitationId);
  if (invitation === undefined) {
    refuse("meeting-unknown-event", "that is not an invitation on a meeting you can reach");
  }
  return invitation;
}
