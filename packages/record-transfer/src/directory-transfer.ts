import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { composeAddAddress } from "@magna-carta/directory/contact-address";
import { composeAddEmail } from "@magna-carta/directory/contact-email";
import { composeAddPhone } from "@magna-carta/directory/contact-phone";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { composeCreateOrganization } from "@magna-carta/directory/organization";
import {
  composePersonRecord,
  type CreatePersonRecordInput,
} from "@magna-carta/directory/person-record";
import { runDirectoryEffect } from "@magna-carta/directory/run-directory-effect";
import type {
  DirectoryOrganizationId,
  DirectoryPersonId,
  TransferRunId,
} from "@magna-carta/identifiers/types";
import type { OrganizationDraft } from "./directory-mapping.ts";
import type { LinkableLocalTable, SourceRecordKey } from "./source-record.ts";
import {
  insertSourceRecordLinkStatement,
  selectLinkedLocalRecordStatement,
} from "./source-record-link-statements.ts";

// The Directory half of the loader: one source person or organization becomes one Directory record,
// once. Each transfer reads the link first. A link means the record already arrived and nothing is
// written; no link means the record and its link are written in one commit, so there is never a
// record without a link or a link without a record.
//
// The record is written by the Directory's own compose functions, so a transferred person is checked
// and stored exactly as one typed at the New Person screen is: the same name history, the same
// phonetic codes, the same audit row naming who ran the transfer.

export interface TransferTarget {
  readonly transferRunId: TransferRunId;
  readonly source: SourceRecordKey;
}

// `created` wrote a record. `alreadyLinked` found the record a previous run made and left it as it
// is: a record somebody may have corrected since is not overwritten from the file it came from.
export type DirectoryTransferOutcome<Id extends string> =
  | { readonly outcome: "created"; readonly localId: Id }
  | { readonly outcome: "alreadyLinked"; readonly localId: Id };

export async function transferPerson(
  context: DirectoryIdentifierContext,
  target: TransferTarget,
  draft: CreatePersonRecordInput,
): Promise<DirectoryTransferOutcome<DirectoryPersonId>> {
  const existing = await linkedRecord<DirectoryPersonId>(context, target, "directory_person");
  if (existing !== null) return { outcome: "alreadyLinked", localId: existing };

  const person = await composePersonRecord(context, draft);
  await commitWithLink(
    context,
    target,
    "directory_person",
    person.personId,
    person.statements,
    person.outboxMessages,
  );
  return { outcome: "created", localId: person.personId };
}

export async function transferOrganization(
  context: DirectoryIdentifierContext,
  target: TransferTarget,
  draft: OrganizationDraft,
): Promise<DirectoryTransferOutcome<DirectoryOrganizationId>> {
  const existing = await linkedRecord<DirectoryOrganizationId>(
    context,
    target,
    "directory_organization",
  );
  if (existing !== null) return { outcome: "alreadyLinked", localId: existing };

  const { database } = context;
  const organization = composeCreateOrganization(database, draft, context);
  const entityId = organization.organizationId;
  const statements: SqlStatement[] = [...organization.statements];
  for (const email of draft.emails) {
    statements.push(...composeAddEmail(database, { ...email, entityId }, context).statements);
  }
  for (const phone of draft.phones) {
    statements.push(...composeAddPhone(database, { ...phone, entityId }, context).statements);
  }
  for (const address of draft.addresses) {
    statements.push(...composeAddAddress(database, { ...address, entityId }, context).statements);
  }
  await commitWithLink(
    context,
    target,
    "directory_organization",
    entityId,
    statements,
    organization.outboxMessages,
  );
  return { outcome: "created", localId: entityId };
}

async function linkedRecord<Id extends string>(
  context: DirectoryIdentifierContext,
  target: TransferTarget,
  localTable: LinkableLocalTable,
): Promise<Id | null> {
  const { results } = await selectLinkedLocalRecordStatement(
    context.database,
    target.source,
    localTable,
  ).all<{ local_id: string }>();
  return (results[0]?.local_id as Id | undefined) ?? null;
}

// The record's rows and its link, in one commit. The link insert carries no conflict clause, so if
// another writer linked the same source record between the read above and this commit, the whole
// batch fails and no second record is left behind.
async function commitWithLink<Id extends string>(
  context: DirectoryIdentifierContext,
  target: TransferTarget,
  localTable: LinkableLocalTable,
  localId: Id,
  statements: readonly SqlStatement[],
  outboxMessages: EffectWrite["outboxMessages"],
): Promise<void> {
  const link = insertSourceRecordLinkStatement(
    context.database,
    {
      source: target.source,
      localTable,
      localId,
      transferRunId: target.transferRunId,
    },
    context.clock.now(),
  );
  await runDirectoryEffect(context.database, undefined, context.clock, () => ({
    statements: [...statements, link],
    outboxMessages,
    responseCode: 201,
    responseBody: { id: localId },
    value: localId,
    fromBody: (body) => (body as { id: Id }).id,
  }));
}
