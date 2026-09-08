import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { composeCreateOrganization } from "@magna-carta/directory/organization";
import { composeCreatePerson, renderDisplayName } from "@magna-carta/directory/person";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  IntakeFormSubmissionId,
  MatterId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  composeCreateIntakeMatter,
  type ClockPort as MatterClockPort,
} from "@magna-carta/matters/matter-service";
import { proposeAcceptance } from "./acceptance.ts";
import { recordAcceptanceStatement } from "./form-statements.ts";
import { IntakeFormValidationError, normalizeTriageNote } from "./validation.ts";

/*
 * ACCEPTING AN ENQUIRY — the moment a stranger becomes somebody the firm has a record of.
 *
 * Everything committed here is what a MEMBER confirmed, never what the visitor typed. The proposal
 * (acceptance.ts) offers the answers mapped onto a record; this takes back what survived a person
 * looking at it. A form is a vector for information to come in; this is where the firm verifies it.
 *
 * ONE BATCH, and that is the design rather than a convenience. The Directory is effectively
 * permanent — soft-delete only, and a merged-away alias deliberately stays in the corpus so it still
 * surfaces a conflicts hit — so an entity written by a sequence that then failed to write its matter
 * would be a person in the firm's conflicts corpus forever, with nothing to show for it and no way
 * to tell it from one somebody meant to add. That is why `composeCreateIntakeMatter` and
 * `composeCreateOrganization` were extracted: so the entity, the matter, the client party link and
 * the submission's own record commit together or not at all.
 */

export interface AcceptanceServiceOptions {
  /**
   * The matters clock, which carries `today()` as well as `now()`.
   *
   * The intake branch draws no number and so needs no civil date — but the matter service's port is
   * one shape for every branch, and narrowing it here would mean a caller could hand acceptance a
   * clock that could not open a consultation, which is the next thing this act grows into.
   */
  readonly clock: MatterClockPort;
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

/** What a member confirmed. Every field is theirs, corrected from the proposal or typed fresh. */
export interface AcceptanceInput {
  readonly submissionId: IntakeFormSubmissionId;
  readonly entityKind: "person" | "organization";
  /** For a person. The parts as the member corrected them, not as the form split them. */
  readonly given?: string | null;
  readonly family?: string | null;
  readonly middle?: string | null;
  /** For an organization. */
  readonly legalName?: string | null;
  readonly matterTitle: string;
  readonly responsibleMemberId: UserId;
  readonly matterTypeId?: MatterTypeId | null;
  readonly note?: string | null;
}

export interface AcceptanceResult {
  readonly entityId: string;
  readonly matterId: MatterId;
  readonly effect: EffectWrite;
}

/**
 * Compose everything acceptance writes.
 *
 * Reads the submission first — through the proposal, which refuses one that has already been
 * accepted — then composes the entity, the matter and the link. The caller commits the batch.
 */
export async function acceptSubmission(
  database: BatchDatabase,
  input: AcceptanceInput,
  options: AcceptanceServiceOptions,
): Promise<AcceptanceResult> {
  // The proposal is the read, and its refusal of an already-accepted submission is the first of two
  // guards. The second is in the link statement's WHERE clause, which is what actually holds under a
  // double-click: a check here alone leaves the window between the read and the write.
  await proposeAcceptance(database, input.submissionId);

  const title = input.matterTitle.trim();
  if (title === "") {
    throw new IntakeFormValidationError("form-empty-title", "the matter needs a title");
  }
  const note = normalizeTriageNote(input.note);

  const directoryOptions = {
    clock: options.clock,
    actorUserId: options.actorUserId,
    randomSource: options.randomSource,
  };

  let entityId: string;
  /*
   * The matter's own display-only client name.
   *
   * `matter.client_display_name` is deliberately NOT the Directory link — the link is the
   * `matter_party` row, and the column is what the docket and every list render without joining. So
   * it has to be set here as well, from the SAME name, or acceptance produces a matter that is
   * correctly linked and shows no client anywhere a member would look. It is rendered by the
   * Directory's own renderer rather than a second one, so the two cannot drift.
   */
  let clientDisplayName: string;
  const entityStatements: EffectWrite["statements"][number][] = [];
  const entityOutbox: EffectWrite["outboxMessages"][number][] = [];

  if (input.entityKind === "organization") {
    const legalName = (input.legalName ?? "").trim();
    if (legalName === "") {
      throw new IntakeFormValidationError(
        "acceptance-needs-a-name",
        "an organization needs a name before it can be recorded",
      );
    }
    const composed = composeCreateOrganization(database, { legalName }, directoryOptions);
    entityId = composed.organizationId;
    clientDisplayName = legalName;
    entityStatements.push(...composed.statements);
    entityOutbox.push(...composed.outboxMessages);
  } else {
    const given = (input.given ?? "").trim();
    const family = (input.family ?? "").trim();
    // A mononym is a real name and the Directory holds it as the family part, so ONE of the two is
    // enough. Neither is not: an entity with no name at all is a row in a permanent conflicts corpus
    // that nothing can ever match against.
    if (given === "" && family === "") {
      throw new IntakeFormValidationError(
        "acceptance-needs-a-name",
        "a person needs a name before they can be recorded",
      );
    }
    const personName = {
      given,
      family,
      middle: input.middle?.trim() === "" ? null : (input.middle ?? null),
    };
    const composed = composeCreatePerson(database, personName, directoryOptions);
    entityId = composed.personId;
    clientDisplayName = renderDisplayName(personName);
    entityStatements.push(...composed.statements);
    entityOutbox.push(...composed.outboxMessages);
  }

  const matter = composeCreateIntakeMatter(
    database,
    {
      title,
      responsibleMemberId: input.responsibleMemberId,
      status: "intake",
      // The client link is written in the SAME batch as the matter, which is what makes the matter
      // unreadable without its client — the intake's conflicts check needs a person to check.
      clientEntityId: entityId,
      clientDisplayName,
      matterTypeId: input.matterTypeId ?? null,
    },
    { clock: options.clock, actorUserId: options.actorUserId, randomSource: options.randomSource },
  );

  const now = options.clock.now();

  return {
    entityId,
    matterId: matter.matterId,
    effect: {
      statements: [
        ...entityStatements,
        ...matter.statements,
        recordAcceptanceStatement(database, {
          id: input.submissionId,
          entityId,
          matterId: matter.matterId,
          note,
          acceptedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "intakeFormSubmission.accepted",
          subjectId: input.submissionId,
          // The MEMBER, never the stranger. This is the first moment a person enters the firm's
          // permanent record, and the platform should be able to say who put them there.
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The handles it created, and nothing the visitor wrote.
          metadata: { entityId, matterId: matter.matterId },
        }),
      ],
      outboxMessages: [...entityOutbox, ...matter.outboxMessages],
    },
  };
}
