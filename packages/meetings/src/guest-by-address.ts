import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { composeAddEmail, findEntitiesByEmailAddress } from "@magna-carta/directory/contact-email";
import { isEmailAddress } from "@magna-carta/directory/email-address";
import { composeCreatePerson } from "@magna-carta/directory/person";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MeetingId } from "@magna-carta/identifiers/types";
import { readHostedMeeting } from "./guest-service.ts";
import { isEntityOnMeetingEvent } from "./guest-statements.ts";
import type { MeetingHostingOptions } from "./hosting-service.ts";
import type { MeetingRow } from "./types.ts";
import { refuse } from "./validation.ts";

/*
 * A guest typed by name and e-mail address rather than picked from the Directory.
 *
 * THE RECORD STILL NAMES A DIRECTORY ENTITY FOR EVERY GUEST, because the conflicts check reads the
 * Directory and a meeting with somebody from outside the firm in it is what that check is for. What
 * the owner ruled on 2026-11-10 is that a host must not be made to find or create that entry first.
 * So the address is matched to an entity that already holds it, and where none does a person is
 * created MARKED NEEDS REVIEW, with that address as their primary e-mail: real enough to be on the
 * record and in the conflicts corpus, and waiting for somebody at the Directory to keep, merge or
 * discard it.
 *
 * THE ENTITY IS THEN PUT ON THE MEETING'S EVENT, which is the only thing that makes them invitable:
 * this function does not invite. The route commits this batch first and then mints the link through
 * `inviteGuest`, unchanged, because the invitation's own reads (on the event, an address the firm may
 * use) have to see these rows committed. A retry is harmless without an idempotency key of its own:
 * the second call finds the person by the address the first one wrote, and finds them on the event.
 */

/** The longest name a host may type for a guest. */
export const GUEST_TYPED_NAME_MAXIMUM_LENGTH = 200;

/**
 * Split a typed name into the given and family parts a Directory person is recorded under: the last
 * word is the family name, the rest the given name. A one-word name is a given name alone. A reviewer
 * corrects the split at the Directory; the conflicts corpus matches on the whole name either way.
 */
export function splitTypedName(name: string): { readonly given: string; readonly family: string } {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length <= 1) return { given: words[0] ?? "", family: "" };
  return { given: words.slice(0, -1).join(" "), family: words.at(-1) ?? "" };
}

export interface GuestByAddress {
  /** The Directory entity the guest is, whether matched or made here. */
  readonly entityId: string;
  /** True when no entity held the address and a needs-review person was made for it. */
  readonly created: boolean;
  readonly effect: EffectWrite;
}

/**
 * Match or make the Directory entity for a typed guest and put it on the meeting's event, as one
 * batch for the caller to commit. Host-only, on the same grant every guest act asks for.
 */
export async function addGuestByAddress(
  database: BatchDatabase,
  meetingId: MeetingId,
  input: { readonly name: string; readonly emailAddress: string },
  options: MeetingHostingOptions,
): Promise<GuestByAddress> {
  const meeting = await readHostedMeeting(database, meetingId, options);

  const name = input.name.trim();
  const address = input.emailAddress.trim();
  if (name.length === 0 || name.length > GUEST_TYPED_NAME_MAXIMUM_LENGTH) {
    refuse("guest-not-invitable", "a guest needs a name");
  }
  // The address is never put in a refusal: it is a person's contact point, and refusals are logged.
  if (!isEmailAddress(address))
    refuse("guest-not-invitable", "that is not a usable e-mail address");

  const statements: SqlStatement[] = [];
  const outboxMessages: EffectWrite["outboxMessages"][number][] = [];

  // Several entities can share an address (a firm's general inbox); the first in handle order is
  // the one chosen, so the same typed address always lands on the same entity.
  const matches = await findEntitiesByEmailAddress(database, address);
  const matched = matches.map((match) => match.entityId).toSorted()[0];

  let entityId: string;
  if (matched === undefined) {
    const person = composeCreatePerson(
      database,
      { ...splitTypedName(name), needsReview: true },
      directoryOptions(options),
    );
    const email = composeAddEmail(
      database,
      { entityId: person.personId, address, isPrimary: true },
      directoryOptions(options),
    );
    statements.push(...person.statements, ...email.statements);
    outboxMessages.push(...person.outboxMessages);
    entityId = person.personId;
  } else {
    entityId = matched;
  }

  const now = options.clock.now();
  if (matched === undefined || !(await isEntityOnMeetingEvent(database, meeting, entityId))) {
    statements.push(addEntityParticipantStatement(database, meeting, entityId, now, options));
  }
  statements.push(
    domainAuditStatement(database, {
      event: "meetings.guest.addedByAddress",
      subjectId: meetingId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      // Identifiers only: never the typed name or the address.
      metadata: { entityId, created: matched === undefined },
    }),
  );
  return { entityId, created: matched === undefined, effect: { statements, outboxMessages } };
}

function directoryOptions(options: MeetingHostingOptions) {
  return {
    clock: options.clock,
    actorUserId: options.actorUserId,
    randomSource: options.randomSource,
  };
}

/** Put a Directory entity on the meeting's event, unless it is already there. */
function addEntityParticipantStatement(
  database: BatchDatabase,
  meeting: Pick<MeetingRow, "event_kind" | "matter_event_id" | "firm_event_id">,
  entityId: string,
  now: string,
  options: MeetingHostingOptions,
): SqlStatement {
  const matter = meeting.event_kind === "matter";
  const table = matter ? "matter_event_participant" : "firm_event_participant";
  const eventColumn = matter ? "event_id" : "firm_event_id";
  const id = matter
    ? newIdentifier("matterEventParticipant", options.randomSource)
    : newIdentifier("firmEventParticipant", options.randomSource);
  return database
    .prepare(
      `INSERT INTO ${table} (id, ${eventColumn}, participant_kind, member_user_id, entity_id, ` +
        `participant_name, role, created_at, updated_at) ` +
        `SELECT ?1, ?2, 'entity', NULL, ?3, NULL, NULL, ?4, ?4 WHERE NOT EXISTS (` +
        `SELECT 1 FROM ${table} WHERE ${eventColumn} = ?2 AND participant_kind = 'entity' AND entity_id = ?3)`,
    )
    .bind(id, matter ? meeting.matter_event_id : meeting.firm_event_id, entityId, now);
}
