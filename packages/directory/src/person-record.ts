/*
 * A whole person, recorded in one batch.
 *
 * The New Person screen reaches every section of the record at creation: names, how to reach them,
 * pronouns, dates, sealed identifiers, the organizations they belong to. Writing those as a create
 * followed by a dozen follow-up requests would leave a half-recorded person on the first one that
 * fails — a name with no number, a number with no name — and a retry that makes a second person.
 * So the whole draft is composed into ONE effect batch: the person's own rows first, then everything
 * that hangs off the id the batch mints, and either all of it lands or none of it does.
 *
 * Every part reuses the module that owns it (composeCreatePerson, composeAddName, composeAddEmail,
 * composeIdentifierWrite, composeCreateEdge …), so what is checked and written here is exactly what
 * the record's own panes check and write one at a time afterwards. What this module adds is the
 * order, the shared id, and the one commit.
 */
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { DirectoryPersonId } from "@magna-carta/identifiers/types";
import type { DirectoryWriteOptions } from "./audit.ts";
import { composeAddAddress, type AddAddressInput } from "./contact-address.ts";
import { composeAddEmail, type AddEmailInput } from "./contact-email.ts";
import { composeAddPhone, type AddPhoneInput } from "./contact-phone.ts";
import { composeCreateEdge } from "./edges.ts";
import { assertEntityExists, entityKindFromId, UnknownEntityError } from "./entity-kind.ts";
import {
  composeIdentifierWrite,
  type AddIdentifierInput,
  type DirectoryIdentifierContext,
} from "./identifiers.ts";
import { composeAddName, type AddPersonNameInput } from "./name-history.ts";
import { checkLifeDates, composeCreatePerson, type CreatePersonInput } from "./person.ts";
import { validatePronounSet, type PronounSet } from "./pronouns.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import { updatePersonLifeDatesStatement, updatePersonPronounsStatement } from "./statements.ts";
import type { EdgeType } from "./types.ts";

/** One organization the person belongs to, and how. The edge's direction is the caller's, as on createEdge. */
export interface PersonOrganizationInput {
  readonly organizationId: string;
  readonly edgeType: EdgeType;
  /** Whether the person is the edge's origin (`from`) or its target (`to`). */
  readonly personIs: "from" | "to";
  readonly role?: string | null;
  readonly note?: string | null;
}

export interface CreatePersonRecordInput {
  readonly name: CreatePersonInput;
  readonly otherNames?: readonly AddPersonNameInput[];
  readonly pronouns?: PronounSet | null;
  readonly dateOfBirth?: string | null;
  readonly dateOfDeath?: string | null;
  readonly emails?: readonly Omit<AddEmailInput, "entityId">[];
  readonly phones?: readonly Omit<AddPhoneInput, "entityId">[];
  readonly addresses?: readonly Omit<AddAddressInput, "entityId">[];
  /** Already in each type's canonical shape (identifier-shape.ts); this module seals, it does not check. */
  readonly identifiers?: readonly AddIdentifierInput[];
  readonly organizations?: readonly PersonOrganizationInput[];
}

/** What recording a whole person contributes to a batch, before anything commits. */
export interface ComposedPersonRecord {
  readonly personId: DirectoryPersonId;
  readonly statements: SqlStatement[];
  readonly outboxMessages: EffectWrite["outboxMessages"][number][];
}

/**
 * Records the person and everything the draft says about them in one batch, and returns the id.
 *
 * The identifier context carries the write options (clock, actor, random source, idempotency) and
 * the firm key the sealed identifiers need; a draft with no identifiers still runs under it, because
 * one seam is easier to keep right than two.
 */
export async function createPersonRecord(
  context: DirectoryIdentifierContext,
  input: CreatePersonRecordInput,
): Promise<DirectoryPersonId> {
  const { personId, statements, outboxMessages } = await composePersonRecord(context, input);
  return runDirectoryEffect(context.database, context.idempotency, context.clock, () => ({
    statements,
    outboxMessages,
    responseCode: 201,
    responseBody: { id: personId },
    value: personId,
    fromBody: (body) => (body as { id: DirectoryPersonId }).id,
  }));
}

/**
 * Composes a whole person without committing. `createPersonRecord` commits exactly this. A caller
 * that must write something else in the same commit, such as the record of where a transferred
 * person came from, composes this and adds its own statements beside it.
 */
export async function composePersonRecord(
  context: DirectoryIdentifierContext,
  input: CreatePersonRecordInput,
): Promise<ComposedPersonRecord> {
  const database: BatchDatabase = context.database;
  const options: DirectoryWriteOptions = {
    clock: context.clock,
    actorUserId: context.actorUserId,
    randomSource: context.randomSource,
    idempotency: context.idempotency,
  };

  // Everything that can be refused is refused before the first row is composed, so a draft with a
  // bad date and a good number never seals the number and then fails.
  const pronouns =
    input.pronouns === undefined || input.pronouns === null
      ? null
      : validatePronounSet(input.pronouns);
  const lifeDates = checkLifeDates({
    dateOfBirth: input.dateOfBirth,
    dateOfDeath: input.dateOfDeath,
  });
  for (const organization of input.organizations ?? []) {
    if (entityKindFromId(organization.organizationId) !== "organization") {
      throw new UnknownEntityError(organization.organizationId);
    }
    await assertEntityExists(database, organization.organizationId);
  }

  const person = composeCreatePerson(database, input.name, options);
  const personId = person.personId;
  const now = options.clock.now();
  const statements: SqlStatement[] = [...person.statements];
  const outboxMessages: EffectWrite["outboxMessages"][number][] = [...person.outboxMessages];

  for (const otherName of input.otherNames ?? []) {
    statements.push(...composeAddName(database, personId, otherName, options));
  }
  if (pronouns !== null) {
    statements.push(updatePersonPronounsStatement(database, personId, pronouns, now));
  }
  if (lifeDates.dateOfBirth !== null || lifeDates.dateOfDeath !== null) {
    statements.push(
      updatePersonLifeDatesStatement(
        database,
        personId,
        {
          dateOfBirth: lifeDates.dateOfBirth,
          dateOfDeath: lifeDates.dateOfDeath,
          deceased: lifeDates.deceased ? 1 : 0,
        },
        now,
      ),
    );
  }
  for (const email of input.emails ?? []) {
    statements.push(
      ...composeAddEmail(database, { ...email, entityId: personId }, options).statements,
    );
  }
  for (const phone of input.phones ?? []) {
    statements.push(
      ...composeAddPhone(database, { ...phone, entityId: personId }, options).statements,
    );
  }
  for (const address of input.addresses ?? []) {
    statements.push(
      ...composeAddAddress(database, { ...address, entityId: personId }, options).statements,
    );
  }
  for (const identifier of input.identifiers ?? []) {
    const sealed = await composeIdentifierWrite(context, personId, identifier);
    statements.push(...sealed.statements);
    outboxMessages.push(...sealed.outboxMessages);
  }
  for (const organization of input.organizations ?? []) {
    const edge = composeCreateEdge(
      database,
      {
        from: organization.personIs === "from" ? personId : (organization.organizationId as never),
        to: organization.personIs === "to" ? personId : (organization.organizationId as never),
        edgeType: organization.edgeType,
        role: organization.role ?? null,
        note: organization.note ?? null,
        validFrom: null,
        validTo: null,
      },
      options,
    );
    statements.push(...edge.statements);
    outboxMessages.push(...edge.outboxMessages);
  }

  return { personId, statements, outboxMessages };
}
