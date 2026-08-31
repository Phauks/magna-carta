/*
 * Everything the firm knows about how to reach one entity, in one read.
 *
 * A record screen wants all three channels at once, and asking for them one at a time is three round
 * trips for one question a person asked once. The three tables stay three at rest — a postal address
 * has nine components and a telecommunication endpoint has one — and they are assembled here, at the
 * read, where the cost is one extra query rather than eight permanently null columns on every row.
 *
 * THE ANSWER IS BOUNDED BY THE RECORD, NOT BY A PAGE. The contact points of one person are the
 * numbers and addresses a firm has written down for that person, which a member enters by hand, one
 * at a time, through a permission-gated route. There is no ingest path into these three tables and no
 * queue consumer that writes them, which is what separates this from a listing that grows with the
 * firm's activity.
 */
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { readAddresses, type DirectoryAddressRow } from "./contact-address.ts";
import { readEmails, type DirectoryEmailRow } from "./contact-email.ts";
import { readPhones, type DirectoryPhoneRow } from "./contact-phone.ts";
import { nodeTableForEntityId, UnknownEntityError } from "./entity-kind.ts";

/** Every contact point on one entity, by channel. */
export interface DirectoryContactPoints {
  readonly emails: readonly DirectoryEmailRow[];
  readonly phones: readonly DirectoryPhoneRow[];
  readonly addresses: readonly DirectoryAddressRow[];
}

/**
 * Read every contact point on an entity.
 *
 * Checks the entity exists first, so an unknown handle is a 404 rather than three empty lists that
 * read as "this person has no contact details". A record folded into another by a merge still
 * answers — somebody following an old link has to land on something that tells them where the record
 * went — which is why this is not the write path's assertion, which refuses a merged entity.
 *
 * The three reads then run together: they touch different tables and neither depends on the other.
 */
export async function readContactPoints(
  database: BatchDatabase,
  entityId: string,
): Promise<DirectoryContactPoints> {
  const table = nodeTableForEntityId(entityId);
  const { results } = await database
    .prepare(`SELECT id FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(entityId)
    .all<{ id: string }>();
  if (results[0] === undefined) throw new UnknownEntityError(entityId);
  const [emails, phones, addresses] = await Promise.all([
    readEmails(database, entityId),
    readPhones(database, entityId),
    readAddresses(database, entityId),
  ]);
  return { emails, phones, addresses };
}
