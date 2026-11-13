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
  returnGuestStayToTheDoorStatement,
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
  type MeetingGuestStayRow,
} from "./guest-types.ts";
import { requireHostGrant, type MeetingHostingOptions } from "./hosting-service.ts";
import { countWaitingAttendance } from "./lobby-statements.ts";
import { MAX_MEETING_LOBBY } from "./lobby-types.ts";
import { readMeeting } from "./meeting-statements.ts";
import type { MeetingDepartureReason, MeetingRow, MeetingStatus } from "./types.ts";
import { MeetingValidationError, refuse, type MeetingValidationCode } from "./validation.ts";

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

/**
 * The label an arrival on an open stay carries when it puts that stay back at the door: the stay was
 * closed by a host, or the door filled, in the round trip since the service read it.
 */
export const GUEST_RETURN_GUARD = "meeting.guest.return";

// The departure labels a guest's stay closes with, named once so the column, the audit metadata and
// the barred-entry read cannot drift on a string.
//
// A stay a HOST closed by acting on the LINK — withdrawing it, or sending a fresh one in its place —
// closes `left`, never `removed`. `removed` and `denied` are the two labels that bar re-entry for the
// life of the meeting, and each is a decision about a PERSON; a withdrawn or replaced link is a
// decision about a credential, and inviting the entity again must bring them back rather than tell
// them they were put out. What the host did is on the audit rows beside it (`cause`).
const DEPARTED = "left" satisfies MeetingDepartureReason;
const SOCKET_LOST = "socket-lost" satisfies MeetingDepartureReason;

/** Why a stay was closed by an act on its link rather than by anybody leaving, as the audit says it. */
type LinkClosureCause = "link-withdrawn" | "link-replaced";

/**
 * An arrival refused because the entity the link was minted for is no longer on the meeting's event.
 *
 * Told to the guest as a withdrawn link — taking somebody off the event is withdrawing their way in,
 * and it is the sentence they can act on — and carrying the audit row the refusal writes, because a
 * host who took somebody off an event did not withdraw the link by hand, and the record should say
 * that it stopped working and why. The route commits `effect` and then answers.
 */
export class GuestNoLongerOnTheEventError extends MeetingValidationError {
  constructor(readonly effect: EffectWrite) {
    super("guest-link-revoked", "the person this link was sent to is no longer on this meeting");
    this.name = "GuestNoLongerOnTheEventError";
  }
}

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
  /**
   * A guest stay the old link held open, CLOSED in this same batch — whoever sits on the old link is
   * not known to be whoever the fresh mail reaches — so the room lets it go once this commits.
   */
  readonly closedStayId: MeetingGuestStayId | null;
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
        openStay: openStay ?? null,
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
    closedStayId: null,
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
 * next request. A stay the old link holds open is CLOSED in the same batch (`left`, which bars
 * nothing): the person the fresh mail reaches arrives on it and waits at the door, and a host admits
 * them knowing who they are — the stay was opened by whoever held the link that was just replaced. A
 * withdrawn link is not rotated: minting again is how a host reinstates one, and a rotation that
 * quietly reinstated a link somebody withdrew would undo a decision nobody re-made.
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
    openStay: openStay ?? null,
    reinstated: false,
    now,
    options,
  });
}

/**
 * A link withdrawn — and a guest on it, in the room or at the door, put out.
 *
 * THE ROW IS KEPT: who was invited is part of what the record says happened, and deleting it would
 * make an invitation that was withdrawn indistinguishable from one never sent. A guest holding an
 * open stay on the link has it closed in the SAME batch, so the withdrawal and the departure commit
 * together; the route tells the room afterwards, on the standing ordering — nobody is told they are
 * out by a write that then failed.
 *
 * THE STAY CLOSES `left`, NOT `removed`. A removal bars the person for the life of the meeting, and
 * withdrawing a link is a decision about the link: a host who invites the entity again means them to
 * come back, and a stay closed `removed` would answer their return with "you were removed". What the
 * host did is the withdrawal's own audit row, which names the stay it closed, and the departure row's
 * `cause`.
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
  readonly closedStayId: MeetingGuestStayId | null;
  readonly effect: EffectWrite;
}> {
  await readHostedMeeting(database, meetingId, options);
  const invitation = await readInvitationOnMeeting(database, meetingId, invitationId);
  if (invitation.revoked_at !== null) {
    return {
      invitation: entryOf(invitation),
      closedStayId: null,
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
      metadata: {
        invitationId: invitation.id,
        entityId: invitation.entity_id,
        revokedAt: now,
        closedStayId: openStay?.id ?? null,
      },
    }),
  ];
  if (openStay !== undefined) {
    statements.push(
      ...closureByLinkStatements(database, meetingId, openStay, now, {
        cause: "link-withdrawn",
        guard: REVOKE_GUEST_LINK_GUARD,
        options,
      }),
    );
  }
  return {
    invitation: { ...entryOf(invitation), revokedAt: now },
    closedStayId: openStay?.id ?? null,
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
 * Why an arrival's spend matched no row, read back off the row as it stands now.
 *
 * The spend carries every condition that makes a link spendable in its own WHERE, so a guarded
 * refusal of it says only that ONE of them moved in the round trip — withdrawn, replaced, used up or
 * run out. Each of those is a different sentence to the person holding the link, and a different
 * remedy, so the route asks the row which one it was rather than answering all four with the same
 * "replaced" it cannot know is true.
 */
export async function whyTheSpendWasRefused(
  database: SqlDatabase,
  credential: GuestCredentialFacts,
  now: string,
): Promise<MeetingValidationCode> {
  const [meeting, invitation] = await Promise.all([
    readMeetingForGuest(database, credential.meetingId),
    readGuestInvitationInMeeting(database, credential.meetingId, credential.invitationId),
  ]);
  const refusal = guestCredentialRefusal({
    invitation,
    meetingStatus: meeting?.status,
    secretVersion: credential.secretVersion,
    secretMatches: null,
    now,
  });
  if (refusal !== null) return refusal;
  if (invitation !== undefined && invitation.arrival_count >= MAX_GUEST_ARRIVALS) {
    return "guest-link-exhausted";
  }
  return "guest-link-not-valid";
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
  // SOMEBODY TAKEN OFF THE EVENT HAS NO LINK INTO ITS MEETING, whatever the row says. The host who
  // took them off may never have opened the Guests panel, which lists invitations by entity rather
  // than by participant — so a live link here would be one nobody running the meeting can see to
  // withdraw. Refused without an audit row, because opening the link is a read and a prefetching mail
  // client must cost nothing; the arrival, which is a write, records it.
  if (!(await isEntityOnMeetingEvent(database, facts, invitation.entity_id))) {
    refuse("guest-link-revoked", "the person this link was sent to is no longer on this meeting");
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
 * answers with THAT stay rather than opening a second, and a second browser on the same link takes
 * the first one's place through the room's one-socket-per-stay rule rather than joining beside it.
 * Every spend is counted against `MAX_GUEST_ARRIVALS`, which is what bounds a link forwarded to a
 * crowd.
 *
 * BUT THE OPEN STAY GOES BACK TO THE DOOR, under the name just typed. Whoever pressed Join this time
 * is not known to be whoever a host let in — it may be the same person on a laptop that slept, or it
 * may be somebody the link was forwarded to — so an admission is never inherited: the host sees the
 * name typed now beside the name the link was minted for, and decides again. The name the stay
 * carried before is kept on the arrival's audit row, because the stay's own column now holds the new
 * one and the record must still be able to say who was admitted under the old.
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
  /** Whether this arrival took the stay back out of the ROOM — the room has to let it go. */
  readonly returnedFromTheRoom: boolean;
  readonly confirmedName: string;
  readonly linkExpiresAt: string;
  readonly medium: MeetingRow["medium"];
  /** Whether the meeting's pictures and sound are sealed end to end. */
  readonly encrypted: boolean;
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
  // THE ENTITY MUST STILL BE ON THE EVENT. Taking somebody off an event is taking away their way into
  // its meeting, and the host who did it may never have looked at the Guests panel. Refused as a
  // withdrawn link, and recorded — nobody withdrew it by hand, so the record would otherwise hold a
  // live-looking invitation that silently stopped working.
  if (!(await isEntityOnMeetingEvent(database, meeting, invitation.entity_id))) {
    throw new GuestNoLongerOnTheEventError({
      statements: [
        domainAuditStatement(database, {
          event: "meetings.guest.arrivalRefused",
          subjectId: credential.meetingId,
          actorUserId: null,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            invitationId: invitation.id,
            entityId: invitation.entity_id,
            reason: "not-on-event",
            refusedAt: now,
          },
        }),
      ],
      outboxMessages: [],
    });
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
    const wasAdmitted = open.admitted_at !== null;
    // Out of the room and back to the door is a new wait, and the door's one ceiling holds for it
    // exactly as it holds for a first arrival. This read produces the reason; the statement's own
    // guard produces the limit.
    if (
      wasAdmitted &&
      (await countWaitingAttendance(database, credential.meetingId)) >= MAX_MEETING_LOBBY
    ) {
      refuse(
        "meeting-lobby-full",
        `this meeting's lobby is full; it holds ${String(MAX_MEETING_LOBBY)} people`,
      );
    }
    return {
      stayId: open.id,
      returnedToOpenStay: true,
      returnedFromTheRoom: wasAdmitted,
      confirmedName,
      linkExpiresAt: invitation.expires_at,
      medium: meeting.medium,
      encrypted: meeting.encrypted === 1,
      effect: {
        statements: [
          spend,
          guarded(
            returnGuestStayToTheDoorStatement(database, {
              id: open.id,
              meetingId: credential.meetingId,
              confirmedName,
              lobbyCapacity: MAX_MEETING_LOBBY,
              now,
            }),
            GUEST_RETURN_GUARD,
          ),
          arrivalAudit(database, credential.meetingId, invitation.id, open.id, now, options, {
            returnedToOpenStay: true,
            returnedFromTheRoom: wasAdmitted,
            // The name the stay carried until now — the one a host admitted, if one did. The stay's
            // column holds the new name from this commit, so this row is where the old one survives.
            previousConfirmedName: open.confirmed_name,
            previouslyAdmittedByUserId: open.admitted_by_user_id,
          }),
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
    returnedFromTheRoom: false,
    confirmedName,
    linkExpiresAt: invitation.expires_at,
    medium: meeting.medium,
    encrypted: meeting.encrypted === 1,
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
        arrivalAudit(database, credential.meetingId, invitation.id, stayId, now, options, {
          returnedToOpenStay: false,
        }),
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
    readonly openStay: MeetingGuestStayRow | null;
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
    closedStayId: input.openStay?.id ?? null,
    invitation: {
      ...entryOf(existing),
      invitedName: input.invitedName,
      expiresAt: input.expiresAt,
      revokedAt: null,
      // A fresh link, a fresh budget — see `reissueGuestInvitationStatement`.
      arrivalCount: 0,
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
            closedStayId: input.openStay?.id ?? null,
          },
        }),
        // THE STAY THE OLD LINK HELD, CLOSED WITH IT. Whoever is sitting on the replaced link is not
        // known to be whoever the fresh mail reaches — replacing a link is the answer to one that
        // reached the wrong people — so the admission it carried is not handed to the new one.
        ...(input.openStay === null
          ? []
          : closureByLinkStatements(database, meetingId, input.openStay, input.now, {
              cause: "link-replaced",
              guard: REISSUE_GUEST_LINK_GUARD,
              options: input.options,
            })),
      ],
      outboxMessages: [],
    },
  };
}

/**
 * A guest's stay closed because a host acted on the LINK — withdrew it, or sent a fresh one in its
 * place — as the statements that write it: `left`, which bars nothing, and the departure row naming
 * what the host did. The host's own act is its own audit row beside these, carrying the actor.
 */
function closureByLinkStatements(
  database: SqlDatabase,
  meetingId: MeetingId,
  stay: MeetingGuestStayRow,
  now: string,
  closure: {
    readonly cause: LinkClosureCause;
    readonly guard: string;
    readonly options: MeetingHostingOptions;
  },
): EffectStatement[] {
  return [
    guarded(
      closeGuestStayStatement(database, { id: stay.id, reason: DEPARTED, now }),
      closure.guard,
    ),
    guestLeftAudit(database, meetingId, stay, DEPARTED, now, closure.options, closure.cause),
  ];
}

function arrivalAudit(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
  stayId: MeetingGuestStayId,
  now: string,
  options: GuestActOptions,
  arrival:
    | { readonly returnedToOpenStay: false }
    | {
        readonly returnedToOpenStay: true;
        readonly returnedFromTheRoom: boolean;
        readonly previousConfirmedName: string;
        readonly previouslyAdmittedByUserId: string | null;
      },
) {
  return domainAuditStatement(database, {
    event: "meetings.guest.arrived",
    subjectId: meetingId,
    actorUserId: null,
    clock: options.clock,
    randomSource: options.randomSource,
    // The spend, and whether it opened a stay or came back to one. The name typed at the door is on
    // the stay row, where the record keeps it; the one exception is the name an arrival REPLACES,
    // which this row is the only place left to keep.
    metadata: { invitationId, stayId, waitingFrom: now, ...arrival },
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
  cause: LinkClosureCause | null = null,
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
      ...(cause === null ? {} : { cause }),
    },
  });
}

// The meeting through the gate a host's read goes through, not ended, and the caller running it.
export async function readHostedMeeting(
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
